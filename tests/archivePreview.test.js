process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');
const { normalizeText } = require('../src/services/historyFactMatcher');

const REQUIRED_VALUES = {
  budget_revenue_total: 100,
  budget_revenue_fiscal: 90,
  budget_expenditure_total: 100,
  budget_expenditure_basic: 60,
  budget_expenditure_project: 40,
  fiscal_grant_revenue_total: 90,
  fiscal_grant_expenditure_total: 90,
  fiscal_grant_expenditure_general: 90,
  three_public_total: 10,
  operation_fund: 5
};

const REQUIRED_ITEMS_EXACT = [
  { key: '收入合计', value: 100 },
  { key: '财政拨款收入', value: 90 },
  { key: '支出合计', value: 100 },
  { key: '基本支出', value: 60 },
  { key: '项目支出', value: 40 },
  { key: '财政拨款收入合计', value: 90 },
  { key: '财政拨款支出合计', value: 90 },
  { key: '一般公共预算财政拨款支出', value: 90 },
  { key: '三公经费合计', value: 10 },
  { key: '机关运行经费', value: 5 }
];

const createDepartmentAndUnit = async ({ unitCode = 'U300', departmentCode = 'D300' } = {}) => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    [departmentCode, 'Archive Preview Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, unitCode, 'Archive Preview Unit']
  );

  return { deptId, unitId: unit.rows[0].id };
};

const seedAdmin = async ({ unitId, deptId, email = 'admin@example.com' }) => {
  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [email, passwordHash, 'Admin User', unitId, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['admin']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id, email };
};

const login = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });
  return response.body.token;
};

const createReport = async ({ deptId, year, userId, reportType = 'BUDGET', fileName = 'sample.pdf' }) => {
  const result = await db.query(
    `INSERT INTO org_dept_annual_report
       (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [deptId, year, reportType, fileName, `/tmp/${fileName}`, `hash-${year}-${reportType}`, 1024, userId]
  );
  return result.rows[0].id;
};

describe('archive preview workflow', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE archive_preview_issue,
        archive_preview_field,
        archive_preview_batch,
        archive_correction_feedback,
        custom_alias_mapping,
        history_actuals,
        org_dept_line_items,
        org_dept_table_data,
        org_dept_text_content,
        org_dept_annual_report,
        user_roles,
        users,
        org_unit,
        org_department
       RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('creates preview, allows field corrections, and commits into history_actuals', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit();
    const { userId, email } = await seedAdmin({ unitId, deptId });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId });

    const previewResponse = await request(app)
      .post('/api/admin/archives/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ report_id: reportId, unit_id: unitId, items: [] });
    expect(previewResponse.status).toBe(201);
    expect(previewResponse.body.status).toBe('PENDING_REVIEW');

    const batchId = previewResponse.body.batch_id;
    const detailResponse = await request(app)
      .get(`/api/admin/archives/preview/${batchId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);

    const fieldMap = new Map(detailResponse.body.fields.map((field) => [field.key, field]));
    for (const [key, value] of Object.entries(REQUIRED_VALUES)) {
      const field = fieldMap.get(key);
      expect(field).toBeTruthy();
      const patchResponse = await request(app)
        .patch(`/api/admin/archives/preview/${batchId}/fields/${field.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ corrected_value: value, confirmed: true });
      expect(patchResponse.status).toBe(200);
    }

    const commitResponse = await request(app)
      .post(`/api/admin/archives/preview/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.status).toBe('COMMITTED');

    const saved = await db.query(
      `SELECT key, value_numeric
       FROM history_actuals
       WHERE unit_id = $1
         AND year = 2025
         AND stage = 'FINAL'`,
      [unitId]
    );
    const savedMap = new Map(saved.rows.map((row) => [row.key, Number(row.value_numeric)]));
    for (const [key, value] of Object.entries(REQUIRED_VALUES)) {
      expect(savedMap.get(key)).toBe(value);
    }
  });

  it('commits normalized values when corrected_value is null', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U300N', departmentCode: 'D300N' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin-null-corrected@example.com' });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'null-corrected.pdf' });

    const previewResponse = await request(app)
      .post('/api/admin/archives/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ report_id: reportId, unit_id: unitId, items: REQUIRED_ITEMS_EXACT });
    expect(previewResponse.status).toBe(201);

    const batchId = previewResponse.body.batch_id;
    const commitResponse = await request(app)
      .post(`/api/admin/archives/preview/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.status).toBe('COMMITTED');

    const saved = await db.query(
      `SELECT key, value_numeric
       FROM history_actuals
       WHERE unit_id = $1
         AND year = 2025
         AND stage = 'FINAL'`,
      [unitId]
    );
    const savedMap = new Map(saved.rows.map((row) => [row.key, Number(row.value_numeric)]));
    expect(savedMap.get('budget_revenue_total')).toBe(100);
    expect(savedMap.get('budget_revenue_fiscal')).toBe(90);
    expect(savedMap.get('budget_expenditure_total')).toBe(100);
    expect(savedMap.get('budget_expenditure_basic')).toBe(60);
    expect(savedMap.get('budget_expenditure_project')).toBe(40);
    expect(savedMap.get('fiscal_grant_revenue_total')).toBe(90);
    expect(savedMap.get('fiscal_grant_expenditure_total')).toBe(90);
    expect(savedMap.get('fiscal_grant_expenditure_general')).toBe(90);
    expect(savedMap.get('three_public_total')).toBe(10);
    expect(savedMap.get('operation_fund')).toBe(5);
  });

  it('permanently deletes a committed batch and removes its history_actuals rows', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U300D', departmentCode: 'D300D' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin-delete-committed@example.com' });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'delete-committed.pdf' });

    const previewResponse = await request(app)
      .post('/api/admin/archives/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ report_id: reportId, unit_id: unitId, items: REQUIRED_ITEMS_EXACT });
    expect(previewResponse.status).toBe(201);

    const batchId = previewResponse.body.batch_id;
    const commitResponse = await request(app)
      .post(`/api/admin/archives/preview/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.status).toBe('COMMITTED');

    // Simulate legacy committed rows created before source_preview_batch_id existed.
    await db.query(
      `UPDATE history_actuals
       SET source_preview_batch_id = NULL
       WHERE unit_id = $1
         AND year = 2025
         AND stage = 'FINAL'
         AND provenance_source = 'archive_preview_commit'`,
      [unitId]
    );

    const deleteResponse = await request(app)
      .delete(`/api/admin/archives/preview/${batchId}/permanent`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);
    expect(Number(deleteResponse.body.deleted_history_actuals || 0)).toBeGreaterThan(0);

    const remainFacts = await db.query(
      `SELECT COUNT(*) AS count
       FROM history_actuals
       WHERE unit_id = $1
         AND year = 2025
         AND stage = 'FINAL'
         AND provenance_source = 'archive_preview_commit'`,
      [unitId]
    );
    expect(Number(remainFacts.rows[0].count)).toBe(0);

    const remainBatch = await db.query(
      `SELECT COUNT(*) AS count
       FROM archive_preview_batch
       WHERE id = $1`,
      [batchId]
    );
    expect(Number(remainBatch.rows[0].count)).toBe(0);
  });

  it('blocks commit when validation errors remain and stores correction feedback', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U301', departmentCode: 'D301' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin2@example.com' });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'sample2.pdf' });

    const previewResponse = await request(app)
      .post('/api/admin/archives/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        report_id: reportId,
        unit_id: unitId,
        items: [{ key: 'totalincome', value: 100 }]
      });
    expect(previewResponse.status).toBe(201);

    const batchId = previewResponse.body.batch_id;
    const detailResponse = await request(app)
      .get(`/api/admin/archives/preview/${batchId}`)
      .set('Authorization', `Bearer ${token}`);
    const revenueField = detailResponse.body.fields.find((field) => field.key === 'budget_revenue_total');
    expect(revenueField).toBeTruthy();

    const patchResponse = await request(app)
      .patch(`/api/admin/archives/preview/${batchId}/fields/${revenueField.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ corrected_value: 123.45, confirmed: true });
    expect(patchResponse.status).toBe(200);

    const feedbackCount = await db.query(
      `SELECT COUNT(*) AS count
       FROM archive_correction_feedback
       WHERE batch_id = $1`,
      [batchId]
    );
    expect(Number(feedbackCount.rows[0].count)).toBeGreaterThanOrEqual(1);

    const aliasCount = await db.query(
      `SELECT COUNT(*) AS count
       FROM custom_alias_mapping
       WHERE source_batch_id = $1`,
      [batchId]
    );
    expect(Number(aliasCount.rows[0].count)).toBeGreaterThanOrEqual(1);

    const commitResponse = await request(app)
      .post(`/api/admin/archives/preview/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(commitResponse.status).toBe(409);
    expect(commitResponse.body.code).toBe('VALIDATION_BLOCKED');
  });

  it('creates multiple preview batches in one request', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U302', departmentCode: 'D302' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin3@example.com' });
    const token = await login(email);

    const reportId1 = await createReport({ deptId, year: 2024, userId, fileName: 'bulk-1.pdf' });
    const reportId2 = await createReport({ deptId, year: 2025, userId, fileName: 'bulk-2.pdf' });

    const response = await request(app)
      .post('/api/admin/archives/preview/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        report_ids: [reportId1, reportId2],
        unit_id: unitId
      });
    expect(response.status).toBe(201);
    expect(response.body.batch_count).toBe(2);
    expect(Array.isArray(response.body.batches)).toBe(true);
    expect(response.body.batches[0].batch_id).toBeTruthy();
    expect(response.body.batches[1].batch_id).toBeTruthy();
  });

  it('uses approved alias mappings in save-budget-facts', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U303', departmentCode: 'D303' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin4@example.com' });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'alias.pdf' });

    const customLabel = 'budgetincomecustom';
    const aliasInsert = await db.query(
      `INSERT INTO custom_alias_mapping
         (raw_label, normalized_label, resolved_key, status)
       VALUES ($1, $2, $3, 'CANDIDATE')
       RETURNING id`,
      [customLabel, normalizeText(customLabel), 'budget_revenue_total']
    );

    const approveResponse = await request(app)
      .patch(`/api/admin/archives/alias-mappings/${aliasInsert.rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'APPROVED' });
    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.alias.status).toBe('APPROVED');

    const saveResponse = await request(app)
      .post('/api/admin/archives/save-budget-facts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        report_id: reportId,
        unit_id: unitId,
        items: [{ key: customLabel, value: 321.45 }]
      });
    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.unmatched_count).toBe(0);
    expect(saveResponse.body.mapped_count).toBeGreaterThanOrEqual(1);

    const historyValue = await db.query(
      `SELECT value_numeric
       FROM history_actuals
       WHERE unit_id = $1
         AND year = 2025
         AND stage = 'FINAL'
         AND key = 'budget_revenue_total'`,
      [unitId]
    );
    expect(Number(historyValue.rows[0].value_numeric)).toBe(321.45);
  });

  it('suppresses noisy unmatched labels and unit-scale manual conflicts in preview issues', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U304', departmentCode: 'D304' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin5@example.com' });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'noise-scale.pdf' });

    const budgetSummaryRows = [
      ['编制部门：示例单位', '单位：万元', '', '', '', '', ''],
      ['收入总计', '100', '', '支出总计', '100', '', ''],
      ['一、财政拨款收入', '90', '', '一、一般公共预算支出', '90', '0', '0']
    ];

    await db.query(
      `INSERT INTO org_dept_table_data
         (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
       VALUES ($1, $2, $3, 'BUDGET', 'budget_summary', $4, $5, $6, $7, $8, $9)`,
      [
        reportId,
        deptId,
        2025,
        '预算单位财务收支预算总表',
        [20],
        budgetSummaryRows.length,
        7,
        JSON.stringify(budgetSummaryRows),
        userId
      ]
    );

    const previewResponse = await request(app)
      .post('/api/admin/archives/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        report_id: reportId,
        unit_id: unitId,
        items: [
          { key: '财政拨款收入', value: 900000 }, // Same value as auto fact, but in 元.
          { key: '九、住房保障支出 9,364,732', value: 9364732 } // Noise label; should be ignored.
        ]
      });
    expect(previewResponse.status).toBe(201);

    const batchId = previewResponse.body.batch_id;
    const detailResponse = await request(app)
      .get(`/api/admin/archives/preview/${batchId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);

    const issues = Array.isArray(detailResponse.body.issues) ? detailResponse.body.issues : [];
    const hasScaleConflict = issues.some(
      (issue) => issue.rule_id === 'ARCHIVE.MANUAL_CONFLICT' && String(issue.message || '').includes('budget_revenue_fiscal')
    );
    const hasNoisyUnmatched = issues.some(
      (issue) => issue.rule_id === 'ARCHIVE.UNMATCHED_LABEL' && String(issue.message || '').includes('住房保障支出')
    );

    expect(hasScaleConflict).toBe(false);
    expect(hasNoisyUnmatched).toBe(false);
  });

  it('marks dual-channel conflicts as low confidence in preview fields', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U305', departmentCode: 'D305' });
    const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin6@example.com' });
    const token = await login(email);
    const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'dual-channel.pdf' });

    const budgetSummaryRows = [
      ['\u7f16\u5236\u90e8\u95e8\uff1a\u793a\u4f8b\u5355\u4f4d', '\u5355\u4f4d\uff1a\u4e07\u5143', '', ''],
      ['\u4e00\u3001\u8d22\u653f\u62e8\u6b3e\u6536\u5165', '100', '\u4e00\u3001\u4e00\u822c\u516c\u5171\u670d\u52a1\u652f\u51fa', '100'],
      ['\u6536\u5165\u603b\u8ba1', '100', '\u652f\u51fa\u603b\u8ba1', '100']
    ];

    await db.query(
      `INSERT INTO org_dept_table_data
         (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
       VALUES ($1, $2, $3, 'BUDGET', 'budget_summary', $4, $5, $6, $7, $8, $9)`,
      [
        reportId,
        deptId,
        2025,
        'budget summary',
        [8],
        budgetSummaryRows.length,
        4,
        JSON.stringify(budgetSummaryRows),
        userId
      ]
    );

    const rawText = [
      '\u6536\u5165\u603b\u8ba1 101',
      '\u652f\u51fa\u603b\u8ba1 100',
      '\u8d22\u653f\u62e8\u6b3e\u6536\u5165 100'
    ].join('\n');
    await db.query(
      `INSERT INTO org_dept_text_content
         (department_id, year, report_type, category, content_text, source_report_id, created_by)
       VALUES ($1, $2, 'BUDGET', 'RAW', $3, $4, $5)`,
      [deptId, 2025, rawText, reportId, userId]
    );

    const previewResponse = await request(app)
      .post('/api/admin/archives/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ report_id: reportId, unit_id: unitId, items: [] });
    expect(previewResponse.status).toBe(201);
    expect(previewResponse.body.reconciliation_summary).toBeTruthy();
    expect(previewResponse.body.reconciliation_summary.structured_conflicted).toBeGreaterThanOrEqual(1);

    const batchId = previewResponse.body.batch_id;
    const detailResponse = await request(app)
      .get(`/api/admin/archives/preview/${batchId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);

    const fieldMap = new Map(detailResponse.body.fields.map((field) => [field.key, field]));
    const revenueField = fieldMap.get('budget_revenue_total');
    expect(revenueField).toBeTruthy();
    expect(revenueField.confidence).toBe('LOW');
    expect(String(revenueField.match_source || '')).toContain('RAW_TEXT_CONFLICT');
    expect(revenueField.confirmed).toBe(false);

    const hasDualConflictIssue = detailResponse.body.issues.some(
      (issue) => issue.rule_id === 'ARCHIVE.DUAL_SOURCE_CONFLICT'
        && issue.evidence
        && issue.evidence.key === 'budget_revenue_total'
    );
    expect(hasDualConflictIssue).toBe(true);
  });

  it('auto-runs OCR for suspicious tables and resolves conflicts when OCR agrees', async () => {
    const prevOcrEnabled = process.env.ARCHIVE_OCR_ENABLED;
    const prevOcrMock = process.env.ARCHIVE_OCR_MOCK_TEXT_JSON;
    process.env.ARCHIVE_OCR_ENABLED = 'true';
    process.env.ARCHIVE_OCR_MOCK_TEXT_JSON = JSON.stringify({
      budget_summary: '\u6536\u5165\u603b\u8ba1 100\n\u652f\u51fa\u603b\u8ba1 100\n\u8d22\u653f\u62e8\u6b3e\u6536\u5165 100'
    });

    try {
      const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U306', departmentCode: 'D306' });
      const { userId, email } = await seedAdmin({ unitId, deptId, email: 'admin7@example.com' });
      const token = await login(email);
      const reportId = await createReport({ deptId, year: 2025, userId, fileName: 'ocr-auto.pdf' });

      const budgetSummaryRows = [
        ['\u7f16\u5236\u90e8\u95e8\uff1a\u793a\u4f8b\u5355\u4f4d', '\u5355\u4f4d\uff1a\u4e07\u5143', '', ''],
        ['\u4e00\u3001\u8d22\u653f\u62e8\u6b3e\u6536\u5165', '100', '\u4e00\u3001\u4e00\u822c\u516c\u5171\u670d\u52a1\u652f\u51fa', '100'],
        ['\u6536\u5165\u603b\u8ba1', '100', '\u652f\u51fa\u603b\u8ba1', '100']
      ];
      await db.query(
        `INSERT INTO org_dept_table_data
           (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
         VALUES ($1, $2, $3, 'BUDGET', 'budget_summary', $4, $5, $6, $7, $8, $9)`,
        [
          reportId,
          deptId,
          2025,
          'budget summary',
          [8],
          budgetSummaryRows.length,
          4,
          JSON.stringify(budgetSummaryRows),
          userId
        ]
      );

      const rawText = [
        '\u6536\u5165\u603b\u8ba1 101',
        '\u652f\u51fa\u603b\u8ba1 100',
        '\u8d22\u653f\u62e8\u6b3e\u6536\u5165 100'
      ].join('\n');
      await db.query(
        `INSERT INTO org_dept_text_content
           (department_id, year, report_type, category, content_text, source_report_id, created_by)
         VALUES ($1, $2, 'BUDGET', 'RAW', $3, $4, $5)`,
        [deptId, 2025, rawText, reportId, userId]
      );

      const previewResponse = await request(app)
        .post('/api/admin/archives/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ report_id: reportId, unit_id: unitId, items: [] });
      expect(previewResponse.status).toBe(201);
      expect(previewResponse.body.ocr_summary).toBeTruthy();
      expect(previewResponse.body.ocr_summary.executed).toBe(true);
      expect(previewResponse.body.ocr_summary.processed_tables).toContain('budget_summary');

      const batchId = previewResponse.body.batch_id;
      const detailResponse = await request(app)
        .get(`/api/admin/archives/preview/${batchId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detailResponse.status).toBe(200);

      const fieldMap = new Map(detailResponse.body.fields.map((field) => [field.key, field]));
      const revenueField = fieldMap.get('budget_revenue_total');
      expect(revenueField).toBeTruthy();
      expect(revenueField.confidence).toBe('HIGH');
      expect(String(revenueField.match_source || '')).toContain('OCR_AGREE');
      expect(String(revenueField.match_source || '')).not.toContain('RAW_TEXT_CONFLICT');
      expect(revenueField.confirmed).toBe(true);
    } finally {
      if (prevOcrEnabled === undefined) {
        delete process.env.ARCHIVE_OCR_ENABLED;
      } else {
        process.env.ARCHIVE_OCR_ENABLED = prevOcrEnabled;
      }
      if (prevOcrMock === undefined) {
        delete process.env.ARCHIVE_OCR_MOCK_TEXT_JSON;
      } else {
        process.env.ARCHIVE_OCR_MOCK_TEXT_JSON = prevOcrMock;
      }
    }
  });
});
