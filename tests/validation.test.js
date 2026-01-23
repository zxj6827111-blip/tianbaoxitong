process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');

const seedReporter = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D200', 'Validation Department']
  );

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [department.rows[0].id, 'U200', 'Validation Unit']
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['validator@example.com', passwordHash, 'Validator', unit.rows[0].id, department.rows[0].id]
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
    .send({ email: 'validator@example.com', password: 'secret' });

  return response.body.token;
};

const createDraftWithFacts = async ({
  unitId,
  year,
  revenueTotal,
  expenditureTotal,
  fiscalRevenueTotal,
  fiscalExpenditureTotal,
  revenueDetails,
  summaryText
}) => {
  const uploadResult = await db.query(
    `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [unitId, year, 'unit', 'mock.xlsx', 'hash', 'PARSED']
  );

  const uploadId = uploadResult.rows[0].id;
  const facts = [
    { key: 'budget_revenue_total', value: revenueTotal, sheet: '预算汇总', cell: 'B6' },
    { key: 'budget_expenditure_total', value: expenditureTotal, sheet: '预算汇总', cell: 'B10' },
    { key: 'budget_revenue_fiscal', value: revenueDetails.fiscal, sheet: '预算汇总', cell: 'B7' },
    { key: 'budget_revenue_business', value: revenueDetails.business, sheet: '预算汇总', cell: 'B8' },
    { key: 'budget_revenue_other', value: revenueDetails.other, sheet: '预算汇总', cell: 'B9' },
    { key: 'fiscal_grant_revenue_total', value: fiscalRevenueTotal, sheet: '财政拨款收支总表', cell: 'B4' },
    { key: 'fiscal_grant_expenditure_total', value: fiscalExpenditureTotal, sheet: '财政拨款收支总表', cell: 'B5' }
  ];

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
              sheet_name: fact.sheet,
              cell_address: fact.cell
            }
          ]
        }),
        'unit_test'
      ]
    );
  }

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
    { key: 'summary_revenue_text', value_text: summaryText }
  ];

  for (const input of manualInputs) {
    await db.query(
      `INSERT INTO manual_inputs (draft_id, key, value_text, evidence)
       VALUES ($1, $2, $3, $4)`,
      [
        draftId,
        input.key,
        input.value_text,
        JSON.stringify({
          anchor: `manual_inputs:${input.key}`
        })
      ]
    );
  }

  return draftId;
};

describe('validation engine', () => {
  beforeAll(() => {
    migrateUp();
  });

  beforeEach(async () => {
    await db.query(`
      TRUNCATE validation_issues, manual_inputs, line_items_reason, report_draft, facts_budget,
        parsed_cells, upload_job, user_roles, users, org_unit, org_department
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('respects 0.009 tolerance and flags 0.011', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U200']);

    const withinDraftId = await createDraftWithFacts({
      unitId: unit.rows[0].id,
      year: 2024,
      revenueTotal: 100.0,
      expenditureTotal: 100.0,
      fiscalRevenueTotal: 50.0,
      fiscalExpenditureTotal: 50.0,
      revenueDetails: { fiscal: 60.0, business: 30.0, other: 10.0 },
      summaryText: '收入合计为100.009万元'
    });

    const passResponse = await request(app)
      .post(`/api/drafts/${withinDraftId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(passResponse.status).toBe(200);
    const warnIds = passResponse.body.issues.map((issue) => issue.rule_id);
    expect(warnIds).not.toContain('BUDGET.RZ005');

    const failDraftId = await createDraftWithFacts({
      unitId: unit.rows[0].id,
      year: 2024,
      revenueTotal: 100.0,
      expenditureTotal: 100.0,
      fiscalRevenueTotal: 50.0,
      fiscalExpenditureTotal: 50.0,
      revenueDetails: { fiscal: 60.0, business: 30.0, other: 10.0 },
      summaryText: '收入合计为100.011万元'
    });

    const failResponse = await request(app)
      .post(`/api/drafts/${failDraftId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(failResponse.status).toBe(200);
    const warnIssue = failResponse.body.issues.find((issue) => issue.rule_id === 'BUDGET.RZ005');
    expect(warnIssue).toBeTruthy();
  });

  it('blocks generate when fatal exists and allows when none', async () => {
    const token = await loginReporter();
    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U200']);

    const fatalDraftId = await createDraftWithFacts({
      unitId: unit.rows[0].id,
      year: 2024,
      revenueTotal: 100.0,
      expenditureTotal: 100.02,
      fiscalRevenueTotal: 50.0,
      fiscalExpenditureTotal: 50.0,
      revenueDetails: { fiscal: 60.0, business: 30.0, other: 10.0 },
      summaryText: '收入合计为100.0万元'
    });

    const fatalResponse = await request(app)
      .post(`/api/drafts/${fatalDraftId}/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(fatalResponse.status).toBe(400);
    expect(fatalResponse.body.code).toBe('FATAL_VALIDATION');
    expect(fatalResponse.body.fatal_count).toBeGreaterThan(0);

    const okDraftId = await createDraftWithFacts({
      unitId: unit.rows[0].id,
      year: 2024,
      revenueTotal: 100.0,
      expenditureTotal: 100.0,
      fiscalRevenueTotal: 50.0,
      fiscalExpenditureTotal: 50.0,
      revenueDetails: { fiscal: 60.0, business: 30.0, other: 10.0 },
      summaryText: '收入合计为100.0万元'
    });

    const okResponse = await request(app)
      .post(`/api/drafts/${okDraftId}/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(okResponse.status).toBe(501);
    expect(okResponse.body.code).toBe('GEN_NOT_IMPLEMENTED');
  });
});
