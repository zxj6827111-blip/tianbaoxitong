process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');
const { generateHistorySampleBuffer } = require('../scripts/gen_history_sample_xlsx');
const { HISTORY_ACTUAL_KEYS } = require('../src/services/historyActualsConfig');

const createDepartmentAndUnit = async ({ unitCode = 'U200', departmentCode = 'D200' } = {}) => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    [departmentCode, 'History Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, unitCode, 'History Unit']
  );

  return { deptId, unitId: unit.rows[0].id };
};

const seedUserWithRole = async ({ roleName, unitId, deptId } = {}) => {
  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [`${roleName}@example.com`, passwordHash, `${roleName} user`, unitId, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id };
};

const login = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });

  return response.body.token;
};

describe('history actuals import and lookup', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE history_actuals,
        history_import_batch,
        report_version,
        report_draft,
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

  it('imports history actuals and creates batch', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U200', departmentCode: 'D200' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const token = await login('admin@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U200',
      year: 2023,
      keys
    });

    const response = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'history.xlsx');

    expect(response.status).toBe(201);
    expect(response.body.batch_id).toBeTruthy();
    expect(response.body.imported_count).toBe(keys.length);

    const batchResult = await db.query(
      'SELECT status FROM history_import_batch WHERE id = $1',
      [response.body.batch_id]
    );
    expect(batchResult.rows[0].status).toBe('IMPORTED');

    const actualsResult = await db.query(
      'SELECT COUNT(*) AS count FROM history_actuals WHERE source_batch_id = $1',
      [response.body.batch_id]
    );
    expect(Number(actualsResult.rows[0].count)).toBe(keys.length);
  });

  it('rejects non-admin import', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U201', departmentCode: 'D201' });
    await seedUserWithRole({ roleName: 'viewer', unitId, deptId });
    const token = await login('viewer@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U201',
      year: 2023,
      keys
    });

    const response = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'history.xlsx');

    expect(response.status).toBe(403);
  });

  it('looks up history values', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U202', departmentCode: 'D202' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    await seedUserWithRole({ roleName: 'viewer', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U202',
      year: 2023,
      keys
    });

    const importResponse = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'history.xlsx');
    expect(importResponse.status).toBe(201);

    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U202']);
    const viewerToken = await login('viewer@example.com');
    const lookupResponse = await request(app)
      .get(`/api/history/lookup?unit_id=${unit.rows[0].id}&year=2023&keys=${keys.join(',')}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(lookupResponse.status).toBe(200);
    expect(Object.keys(lookupResponse.body.values).length).toBe(keys.length);
    expect(lookupResponse.body.missing_keys.length).toBe(0);
  });

  it('locks batch to prevent overwrite', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U203', departmentCode: 'D203' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U203',
      year: 2023,
      keys
    });

    const importResponse = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'history.xlsx');
    expect(importResponse.status).toBe(201);

    const lockResponse = await request(app)
      .post(`/api/admin/history/batch/${importResponse.body.batch_id}/lock`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(lockResponse.status).toBe(200);

    const retryResponse = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'history.xlsx');

    expect(retryResponse.status).toBe(409);
  });

  it('lists archive years and returns yearly field values for admin panel', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U204', departmentCode: 'D204' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    await db.query(
      `INSERT INTO history_actuals (unit_id, year, stage, key, value_numeric, is_locked)
       VALUES
         ($1, 2023, 'FINAL', 'budget_revenue_total', 123.45, false),
         ($1, 2024, 'FINAL', 'budget_revenue_total', 456.78, true),
         ($1, 2024, 'FINAL', 'three_public_outbound', 11.11, true),
         ($1, 2024, 'FINAL', 'three_public_reception', 22.22, true)`,
      [unitId]
    );

    const yearsResponse = await request(app)
      .get(`/api/admin/history/units/${unitId}/years`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(yearsResponse.status).toBe(200);
    expect(yearsResponse.body.years.map((item) => item.year)).toEqual([2024, 2023]);

    const valuesResponse = await request(app)
      .get(`/api/admin/history/units/${unitId}/years/2024`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(valuesResponse.status).toBe(200);
    const fieldMap = new Map(valuesResponse.body.fields.map((item) => [item.key, item.value]));
    expect(fieldMap.get('budget_revenue_total')).toBe(456.78);
    expect(fieldMap.get('three_public_outbound')).toBe(11.11);
    expect(fieldMap.get('three_public_reception')).toBe(22.22);
    expect(fieldMap.has('three_public_vehicle_total')).toBe(true);
  });

  it('saves parsed archive facts into history actuals and supports yearly lookup', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U205', departmentCode: 'D205' });
    const { userId } = await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const reportResult = await db.query(
      `INSERT INTO org_dept_annual_report
         (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
       VALUES ($1, $2, 'BUDGET', 'sample.pdf', '/tmp/sample.pdf', 'hash-1', 1234, $3)
       RETURNING id`,
      [deptId, 2025, userId]
    );

    const saveResponse = await request(app)
      .post('/api/admin/archives/save-budget-facts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        report_id: reportResult.rows[0].id,
        unit_id: unitId,
        items: [
          { key: '收入合计', value: 101.11 },
          { key: '财政拨款收入', value: 88.66 },
          { key: '因公出国（境）费', value: 6.22 },
          { key: '公务接待费', value: 2.05 },
          { key: '未匹配字段', value: 9.99 }
        ]
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.upserted_count).toBeGreaterThanOrEqual(4);
    expect(saveResponse.body.unmatched_count).toBeGreaterThanOrEqual(1);

    const yearsResponse = await request(app)
      .get(`/api/admin/history/units/${unitId}/years`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(yearsResponse.status).toBe(200);
    expect(yearsResponse.body.years[0].year).toBe(2025);

    const valuesResponse = await request(app)
      .get(`/api/admin/history/units/${unitId}/years/2025`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(valuesResponse.status).toBe(200);

    const fieldMap = new Map(valuesResponse.body.fields.map((item) => [item.key, item.value]));
    expect(fieldMap.get('budget_revenue_total')).toBe(101.11);
    expect(fieldMap.get('budget_revenue_fiscal')).toBe(88.66);
    expect(fieldMap.get('three_public_outbound')).toBe(6.22);
    expect(fieldMap.get('three_public_reception')).toBe(2.05);
  });

  it('auto extracts core fields from parsed table_data when manual items are noisy', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U206', departmentCode: 'D206' });
    const { userId } = await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const reportResult = await db.query(
      `INSERT INTO org_dept_annual_report
         (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
       VALUES ($1, $2, 'BUDGET', 'sample.pdf', '/tmp/sample.pdf', 'hash-2', 1234, $3)
       RETURNING id`,
      [deptId, 2025, userId]
    );
    const reportId = reportResult.rows[0].id;

    const budgetSummaryRows = [
      ['编制部门：测试部门', '单位：元'],
      ['本年收入', '本年支出'],
      ['项目', '预算数', '项目', '预算数'],
      ['一、财政拨款收入', '189,767,551', '一、一般公共服务支出', '3,296,600'],
      ['二、事业收入', '', '二、公共安全支出', '2,878,025'],
      ['三、事业单位经营收入', '', '三、教育支出', '250,000'],
      ['四、其他收入', '', '四、科学技术支出', '100,000'],
      ['收入总计', '189,767,551', '支出总计', '189,767,551']
    ];
    const threePublicRows = [
      ['编制部门：测试部门', '单位:万元'],
      ['合计', '因公出国(境)费', '公务接待费'],
      ['小计', '购置费', '运行费'],
      ['37.91', '0', '1.35', '36.56', '15', '21.56', '464.64']
    ];

    await db.query(
      `INSERT INTO org_dept_table_data
         (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
       VALUES
         ($1, $2, 2025, 'BUDGET', 'budget_summary', 'budget_summary', '{1}', $3, 4, $4::jsonb, $5),
         ($1, $2, 2025, 'BUDGET', 'three_public', 'three_public', '{2}', $6, 7, $7::jsonb, $5)`,
      [
        reportId,
        deptId,
        budgetSummaryRows.length,
        JSON.stringify(budgetSummaryRows),
        userId,
        threePublicRows.length,
        JSON.stringify(threePublicRows)
      ]
    );

    const saveResponse = await request(app)
      .post('/api/admin/archives/save-budget-facts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        report_id: reportId,
        unit_id: unitId,
        items: [{ key: '201 05 07 专项普查活动 438300 438300 0 0 0', value: 0 }]
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.auto_mapped_count).toBeGreaterThanOrEqual(8);
    expect(saveResponse.body.upserted_count).toBeGreaterThanOrEqual(8);

    const valuesResponse = await request(app)
      .get(`/api/admin/history/units/${unitId}/years/2025`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(valuesResponse.status).toBe(200);

    const fieldMap = new Map(valuesResponse.body.fields.map((item) => [item.key, item.value]));
    expect(fieldMap.get('budget_revenue_total')).toBe(18976.76);
    expect(fieldMap.get('budget_revenue_fiscal')).toBe(18976.76);
    expect(fieldMap.get('budget_expenditure_total')).toBe(18976.76);
    expect(fieldMap.get('fiscal_grant_revenue_total')).toBe(18976.76);
    expect(fieldMap.get('fiscal_grant_expenditure_total')).toBe(18976.76);
    expect(fieldMap.get('three_public_total')).toBe(37.91);
    expect(fieldMap.get('three_public_reception')).toBe(1.35);
    expect(fieldMap.get('three_public_vehicle_operation')).toBe(21.56);
    expect(fieldMap.get('operation_fund')).toBe(464.64);
  });

  it('keeps auto table facts when manual parser has likely unit-mismatch values', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U207', departmentCode: 'D207' });
    const { userId } = await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const reportResult = await db.query(
      `INSERT INTO org_dept_annual_report
         (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
       VALUES ($1, $2, 'BUDGET', 'sample.pdf', '/tmp/sample.pdf', 'hash-3', 1234, $3)
       RETURNING id`,
      [deptId, 2025, userId]
    );
    const reportId = reportResult.rows[0].id;

    const threePublicRows = [
      ['header'],
      ['total', 'outbound', 'reception', 'vehicle_total', 'vehicle_purchase', 'vehicle_operation', 'operation'],
      ['37.91', '0', '1.35', '36.56', '15', '21.56', '464.64']
    ];

    await db.query(
      `INSERT INTO org_dept_table_data
         (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
       VALUES
         ($1, $2, 2025, 'BUDGET', 'three_public', 'three_public', '{1}', $3, 7, $4::jsonb, $5)`,
      [
        reportId,
        deptId,
        threePublicRows.length,
        JSON.stringify(threePublicRows),
        userId
      ]
    );

    const saveResponse = await request(app)
      .post('/api/admin/archives/save-budget-facts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        report_id: reportId,
        unit_id: unitId,
        items: [
          { key: 'threepublictotal', value: 379100 },
          { key: 'receptionexpense', value: 13500 }
        ]
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.manual_conflict_skipped_count).toBeGreaterThanOrEqual(2);

    const valuesResponse = await request(app)
      .get(`/api/admin/history/units/${unitId}/years/2025`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(valuesResponse.status).toBe(200);

    const fieldMap = new Map(valuesResponse.body.fields.map((item) => [item.key, item.value]));
    expect(fieldMap.get('three_public_total')).toBe(37.91);
    expect(fieldMap.get('three_public_reception')).toBe(1.35);
    expect(fieldMap.get('operation_fund')).toBe(464.64);
  });
});
