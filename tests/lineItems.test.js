process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');
const { LINE_ITEM_DEFINITIONS } = require('../src/services/lineItemsService');

const seedReporter = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D201', 'Line Items Department']
  );

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [department.rows[0].id, 'U201', 'Line Items Unit']
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['lineitems@example.com', passwordHash, 'Line Items Reporter', unit.rows[0].id, department.rows[0].id]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['reporter']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id, unitId: unit.rows[0].id };
};

const loginReporter = async () => {
  await seedReporter();
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'lineitems@example.com', password: 'secret' });

  return response.body.token;
};

const insertFacts = async ({ uploadId, unitId, year, facts }) => {
  for (const fact of facts) {
    await db.query(
      `INSERT INTO facts_budget (upload_id, unit_id, year, key, value_numeric, evidence, provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uploadId,
        unitId,
        year,
        fact.key,
        fact.value,
        JSON.stringify({
          cells: [
            {
              sheet_name: fact.sheet || '财政拨款支出主要内容',
              cell_address: fact.cell || 'B1'
            }
          ]
        }),
        'unit_test'
      ]
    );
  }
};

const createDraftWithLineItems = async ({ unitId, year, lineItemValues }) => {
  const uploadResult = await db.query(
    `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [unitId, year, 'unit', 'mock.xlsx', 'hash', 'PARSED']
  );

  const uploadId = uploadResult.rows[0].id;
  const baseFacts = [
    { key: 'budget_revenue_total', value: 100.0, sheet: '预算汇总', cell: 'B6' },
    { key: 'budget_expenditure_total', value: 100.0, sheet: '预算汇总', cell: 'B10' },
    { key: 'budget_revenue_fiscal', value: 60.0, sheet: '预算汇总', cell: 'B7' },
    { key: 'budget_revenue_business', value: 30.0, sheet: '预算汇总', cell: 'B8' },
    { key: 'budget_revenue_other', value: 10.0, sheet: '预算汇总', cell: 'B9' },
    { key: 'fiscal_grant_revenue_total', value: 50.0, sheet: '财政拨款收支总表', cell: 'B4' },
    { key: 'fiscal_grant_expenditure_total', value: 50.0, sheet: '财政拨款收支总表', cell: 'B5' }
  ];

  const lineItemFacts = [];
  for (const [itemKey, values] of Object.entries(lineItemValues)) {
    const definition = LINE_ITEM_DEFINITIONS.find((item) => item.item_key === itemKey);
    if (!definition) {
      continue;
    }
    if (values.current !== undefined) {
      lineItemFacts.push({ key: definition.current_key, value: values.current });
    }
    if (values.prev !== undefined) {
      lineItemFacts.push({ key: definition.prev_key, value: values.prev });
    }
  }

  await insertFacts({
    uploadId,
    unitId,
    year,
    facts: [...baseFacts, ...lineItemFacts]
  });

  const draftResult = await db.query(
    `INSERT INTO report_draft (unit_id, year, template_version, status, upload_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [unitId, year, 'shanghai_v1', 'DRAFT', uploadId]
  );

  const draftId = draftResult.rows[0].id;

  const manualInputs = [
    { key: 'unit_full_name', value_text: '测试单位' },
    { key: 'report_contact', value_text: '联系人' },
    { key: 'summary_revenue_text', value_text: '收入合计为100.0万元' }
  ];

  for (const input of manualInputs) {
    await db.query(
      `INSERT INTO manual_inputs (draft_id, key, value_text, evidence)
       VALUES ($1, $2, $3, $4)`,
      [
        draftId,
        input.key,
        input.value_text,
        JSON.stringify({ anchor: `manual_inputs:${input.key}` })
      ]
    );
  }

  return draftId;
};

const addDynamicLineItemsToDraft = async ({ draftId, unitId, year, items }) => {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const draftResult = await db.query(
    `SELECT upload_id
     FROM report_draft
     WHERE id = $1`,
    [draftId]
  );
  const uploadId = draftResult.rows[0]?.upload_id;
  if (!uploadId) {
    throw new Error(`Draft upload not found: ${draftId}`);
  }

  const factRows = items
    .filter((item) => item && item.code && item.current !== undefined && item.current !== null)
    .map((item) => ({
      key: `amount_line_item_${item.code}`,
      value: item.current
    }));

  if (factRows.length > 0) {
    await insertFacts({
      uploadId,
      unitId,
      year,
      facts: factRows
    });
  }

  const manualInputMap = new Map();
  for (const item of items) {
    if (!item || !item.code) continue;
    if (item.classCode && item.className) {
      manualInputMap.set(`name_class_${item.classCode}`, item.className);
    }
    if (item.typeCode && item.typeName) {
      manualInputMap.set(`name_type_${item.typeCode}`, item.typeName);
    }
    if (item.itemName) {
      manualInputMap.set(`name_line_item_${item.code}`, item.itemName);
    }
  }

  for (const [key, valueText] of manualInputMap.entries()) {
    await db.query(
      `INSERT INTO manual_inputs (draft_id, key, value_text, evidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (draft_id, key)
       DO UPDATE SET value_text = EXCLUDED.value_text, evidence = EXCLUDED.evidence, updated_at = now()`,
      [
        draftId,
        key,
        valueText,
        JSON.stringify({ anchor: `manual_inputs:${key}` })
      ]
    );
  }
};

describe('line items API', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(`
      TRUNCATE report_version, validation_issues, manual_inputs, line_items_reason, report_draft, facts_budget,
        parsed_cells, upload_job, user_roles, users, org_unit, org_department
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('persists bulk reasons and returns preview text', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U201']);

    const values = {
      [LINE_ITEM_DEFINITIONS[0].item_key]: { current: 120, prev: 100 },
      [LINE_ITEM_DEFINITIONS[1].item_key]: { current: 50, prev: 45 },
      [LINE_ITEM_DEFINITIONS[2].item_key]: { current: 30, prev: 30 }
    };

    const draftId = await createDraftWithLineItems({
      unitId: unit.rows[0].id,
      year: 2024,
      lineItemValues: values
    });

    const patchResponse = await request(app)
      .patch(`/api/drafts/${draftId}/line-items`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { item_key: LINE_ITEM_DEFINITIONS[0].item_key, reason_text: '人员经费增加' },
          { item_key: LINE_ITEM_DEFINITIONS[1].item_key, reason_text: '公用经费调整' }
        ]
      });

    expect(patchResponse.status).toBe(200);
    const getResponse = await request(app)
      .get(`/api/drafts/${draftId}/line-items`)
      .set('Authorization', `Bearer ${token}`);

    expect(getResponse.status).toBe(200);
    const firstItem = getResponse.body.items.find((item) => item.item_key === LINE_ITEM_DEFINITIONS[0].item_key);
    expect(firstItem.reason_text).toBe('人员经费增加');
    expect(getResponse.body.preview_text).toContain('人员经费');
    expect(getResponse.body.preview_text).toContain('公用经费');
    expect(getResponse.body.preview_text).toContain('项目支出');
  });

  it('normalizes auto-composed reason text to reason snippet', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U201']);
    const projectKey = LINE_ITEM_DEFINITIONS[2].item_key;
    const autoComposedReason = '“项目支出”30.00万元，上年:20.00万元，主要群众体育。';

    const prevDraftId = await createDraftWithLineItems({
      unitId: unit.rows[0].id,
      year: 2024,
      lineItemValues: {
        [projectKey]: { current: 30, prev: 20 }
      }
    });

    await db.query(
      `INSERT INTO line_items_reason (draft_id, item_key, reason_text, order_no, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [prevDraftId, projectKey, autoComposedReason, 3, 3]
    );

    const currentDraftId = await createDraftWithLineItems({
      unitId: unit.rows[0].id,
      year: 2025,
      lineItemValues: {
        [projectKey]: { current: 32, prev: 30 }
      }
    });

    const getResponse = await request(app)
      .get(`/api/drafts/${currentDraftId}/line-items`)
      .set('Authorization', `Bearer ${token}`);

    expect(getResponse.status).toBe(200);
    const projectItem = getResponse.body.items.find((item) => item.item_key === projectKey);
    expect(projectItem).toBeTruthy();
    expect(projectItem.previous_reason_text).toBe('群众体育');
    expect(projectItem.reason_text).toBe('群众体育');
    expect(projectItem.reason_text).not.toContain('万元');

    const patchResponse = await request(app)
      .patch(`/api/drafts/${currentDraftId}/line-items`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { item_key: projectKey, reason_text: autoComposedReason }
        ]
      });

    expect(patchResponse.status).toBe(200);
    const patchedItem = patchResponse.body.items.find((item) => item.item_key === projectKey);
    expect(patchedItem).toBeTruthy();
    expect(patchedItem.reason_text).toBe('群众体育');
    expect(patchedItem.reason_is_manual).toBe(true);
  });

  it('matches previous-year reasons from fiscal detail list without table-row pollution', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id, department_id FROM org_unit WHERE code = $1', ['U201']);
    const unitId = unit.rows[0].id;
    const departmentId = unit.rows[0].department_id;

    const draftId = await createDraftWithLineItems({
      unitId,
      year: 2025,
      lineItemValues: {}
    });

    await addDynamicLineItemsToDraft({
      draftId,
      unitId,
      year: 2025,
      items: [
        {
          code: '2012902',
          classCode: '201',
          className: '一般公共服务支出',
          typeCode: '20129',
          typeName: '群众团体事务',
          itemName: '一般行政管理事务',
          current: 422900
        },
        {
          code: '2080505',
          classCode: '208',
          className: '社会保障和就业支出',
          typeCode: '20805',
          typeName: '行政事业单位养老支出',
          itemName: '机关事业单位基本养老保险缴费支出',
          current: 4827200
        },
        {
          code: '2100717',
          classCode: '210',
          className: '卫生健康支出',
          typeCode: '21007',
          typeName: '计划生育事务',
          itemName: '计划生育服务',
          current: 200000
        },
        {
          code: '2120102',
          classCode: '212',
          className: '城乡社区支出',
          typeCode: '21201',
          typeName: '城乡社区管理事务',
          itemName: '一般行政管理事务',
          current: 17464200
        },
        {
          code: '2120199',
          classCode: '212',
          className: '城乡社区支出',
          typeCode: '21201',
          typeName: '城乡社区管理事务',
          itemName: '其他城乡社区管理事务支出',
          current: 53121100
        }
      ]
    });

    const fiscalDetailText = [
      '财政拨款支出主要内容如下：',
      '2. “一般公共服务支出（类）群众团体事务（款）一般行政管理事务（项）”科目42.29万元，主要用于群众团体事务一般行政管理',
      '事务。',
      '13. “社会保障和就业支出（类）行政事业单位养老支出（款）机关事业单位基本养老保险缴费支出（项）”科目171.94万元，主要',
      '用于机关事业单位基本养老保险缴费支出。',
      '23. “城乡社区支出（类）城乡社区管理事务（款）一般行政管理事务（项）”科目1746.42万元，主要用于城乡社区管理事务一般',
      '行政管理事务。',
      '2024年预算单位收入预算总表',
      '210 07 17 计划生育服务 200,000 200,000 0 0 0',
      '212 01 城乡社区管理事务 35,201,982 17,737,739 17,464,243'
    ].join('\n');

    await db.query(
      `INSERT INTO org_dept_text_content
        (department_id, unit_id, year, report_type, category, content_text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [departmentId, unitId, 2024, 'BUDGET', 'EXPLANATION_FISCAL_DETAIL', fiscalDetailText]
    );

    const response = await request(app)
      .get(`/api/drafts/${draftId}/line-items`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const findItem = (code) => response.body.items.find((item) => item.item_key === `line_item_${code}`);
    const item2012902 = findItem('2012902');
    const item2080505 = findItem('2080505');
    const item2100717 = findItem('2100717');
    const item2120102 = findItem('2120102');
    const item2120199 = findItem('2120199');

    expect(item2012902.previous_reason_text).toBe('群众团体事务一般行政管理事务');
    expect(item2012902.reason_text).toBe('群众团体事务一般行政管理事务');

    expect(item2080505.previous_reason_text).toBe('机关事业单位基本养老保险缴费支出');
    expect(item2080505.reason_text).toBe('机关事业单位基本养老保险缴费支出');

    expect(item2120102.previous_reason_text).toBe('城乡社区管理事务一般行政管理事务');
    expect(item2120102.reason_text).toBe('城乡社区管理事务一般行政管理事务');

    expect(item2100717.previous_reason_text || '').toBe('');
    expect(item2100717.reason_text || '').toBe('');
    expect(item2120199.previous_reason_text || '').toBe('');
    expect(item2120199.reason_text || '').toBe('');
  });

  it('parses Chinese-numbered fiscal entries as separate reasons via structured path', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id, department_id FROM org_unit WHERE code = $1', ['U201']);
    const unitId = unit.rows[0].id;
    const departmentId = unit.rows[0].department_id;

    const draftId = await createDraftWithLineItems({
      unitId,
      year: 2025,
      lineItemValues: {}
    });

    await addDynamicLineItemsToDraft({
      draftId,
      unitId,
      year: 2025,
      items: [
        {
          code: '2080505',
          classCode: '208',
          className: '社会保障和就业支出',
          typeCode: '20805',
          typeName: '行政事业单位养老支出',
          itemName: '机关事业单位基本养老保险缴费支出',
          current: 4827200
        },
        {
          code: '2120102',
          classCode: '212',
          className: '城乡社区支出',
          typeCode: '21201',
          typeName: '城乡社区管理事务',
          itemName: '一般行政管理事务',
          current: 17464200
        }
      ]
    });

    const fiscalDetailText = [
      '财政拨款支出主要内容如下：',
      '（一）“社会保障和就业支出（类）行政事业单位养老支出（款）机关事业单位基本养老保险缴费支出（项）”科目471.94万元，主要用于机关事业单位基本养老保险缴费支出。',
      '（二）“城乡社区支出（类）城乡社区管理事务（款）一般行政管理事务（项）”科目1746.42万元，主要用于城乡社区管理事务一般行政管理事务。'
    ].join('\n');

    await db.query(
      `INSERT INTO org_dept_text_content
        (department_id, unit_id, year, report_type, category, content_text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [departmentId, unitId, 2024, 'BUDGET', 'EXPLANATION_FISCAL_DETAIL', fiscalDetailText]
    );

    const response = await request(app)
      .get(`/api/drafts/${draftId}/line-items`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const findItem = (code) => response.body.items.find((item) => item.item_key === `line_item_${code}`);
    const item2080505 = findItem('2080505');
    const item2120102 = findItem('2120102');

    expect(item2080505.previous_reason_text).toBe('机关事业单位基本养老保险缴费支出');
    expect(item2080505.reason_text).toBe('机关事业单位基本养老保险缴费支出');

    expect(item2120102.previous_reason_text).toBe('城乡社区管理事务一般行政管理事务');
    expect(item2120102.reason_text).toBe('城乡社区管理事务一般行政管理事务');

    expect(item2080505.previous_reason_text).not.toBe(item2120102.previous_reason_text);
  });

  it('flags fatal when required reason is missing', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U201']);

    const draftId = await createDraftWithLineItems({
      unitId: unit.rows[0].id,
      year: 2024,
      lineItemValues: {
        [LINE_ITEM_DEFINITIONS[0].item_key]: { current: 10, prev: 0 }
      }
    });

    const response = await request(app)
      .post(`/api/drafts/${draftId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    const reasonIssue = response.body.issues.find((issue) => issue.rule_id === 'REASON_REQUIRED_MISSING');
    expect(reasonIssue).toBeTruthy();
    expect(reasonIssue.level).toBe('FATAL');
    expect(reasonIssue.evidence.item_key).toBe(LINE_ITEM_DEFINITIONS[0].item_key);
  });

  it('does not flag when change ratio is below threshold', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U201']);

    const draftId = await createDraftWithLineItems({
      unitId: unit.rows[0].id,
      year: 2024,
      lineItemValues: {
        [LINE_ITEM_DEFINITIONS[0].item_key]: { current: 109.9, prev: 100 }
      }
    });

    const response = await request(app)
      .post(`/api/drafts/${draftId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    const reasonIssue = response.body.issues.find((issue) => issue.rule_id === 'REASON_REQUIRED_MISSING');
    expect(reasonIssue).toBeFalsy();
  });

  it('flags when change ratio meets the threshold boundary', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U201']);

    const draftId = await createDraftWithLineItems({
      unitId: unit.rows[0].id,
      year: 2024,
      lineItemValues: {
        [LINE_ITEM_DEFINITIONS[0].item_key]: { current: 110.0, prev: 100 }
      }
    });

    const response = await request(app)
      .post(`/api/drafts/${draftId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(200);
    const reasonIssue = response.body.issues.find((issue) => issue.rule_id === 'REASON_REQUIRED_MISSING');
    expect(reasonIssue).toBeTruthy();
  });
});
