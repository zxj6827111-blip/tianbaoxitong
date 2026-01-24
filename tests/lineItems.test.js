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
