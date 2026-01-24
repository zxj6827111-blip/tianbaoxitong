process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const ExcelJS = require('exceljs');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');
const { generateSampleUnitBuffer } = require('../scripts/gen_sample_unit_xlsx');

const seedReporter = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D100', 'Test Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, 'U100', 'Test Unit']
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['reporter@example.com', passwordHash, 'Reporter', unit.rows[0].id, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['reporter']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id };
};

const loginReporter = async () => {
  await seedReporter();
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reporter@example.com', password: 'secret' });

  return response.body.token;
};

describe('uploads and parsing', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(`
      TRUNCATE manual_inputs, report_version, report_draft, facts_budget, parsed_cells, upload_job,
        user_roles, users, org_unit, org_department
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('uploads, parses, and creates draft with facts', async () => {
    const token = await loginReporter();
    const buffer = await generateSampleUnitBuffer({ year: 2024 });

    const uploadResponse = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('year', '2024')
      .attach('file', buffer, 'sample_unit.xlsx');

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.upload_id).toBeTruthy();
    expect(uploadResponse.body.file_hash).toBeTruthy();

    const parseResponse = await request(app)
      .post(`/api/uploads/${uploadResponse.body.upload_id}/parse`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.draft_id).toBeTruthy();
    expect(parseResponse.body.extracted_keys_count).toBeGreaterThanOrEqual(10);

    const parsedCellsResult = await db.query(
      'SELECT COUNT(*) AS count, COUNT(anchor) AS anchor_count FROM parsed_cells WHERE upload_id = $1',
      [uploadResponse.body.upload_id]
    );
    expect(Number(parsedCellsResult.rows[0].count)).toBeGreaterThanOrEqual(12);
    expect(Number(parsedCellsResult.rows[0].anchor_count)).toBeGreaterThan(0);

    const factsResult = await db.query(
      'SELECT key, value_numeric, evidence FROM facts_budget WHERE upload_id = $1 ORDER BY key',
      [uploadResponse.body.upload_id]
    );
    expect(factsResult.rows.length).toBeGreaterThanOrEqual(10);

    const revenueTotal = factsResult.rows.find((row) => row.key === 'budget_revenue_total');
    expect(Number(revenueTotal.value_numeric)).toBeCloseTo(11000000, 2);
    expect(revenueTotal.evidence).toBeTruthy();

    const draftResult = await db.query(
      'SELECT unit_id, year, template_version, status, upload_id FROM report_draft WHERE id = $1',
      [parseResponse.body.draft_id]
    );
    expect(draftResult.rowCount).toBe(1);
    expect(draftResult.rows[0].template_version).toBe('shanghai_v1');
    expect(draftResult.rows[0].upload_id).toBe(uploadResponse.body.upload_id);

    const draftApiResponse = await request(app)
      .get(`/api/drafts/${parseResponse.body.draft_id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(draftApiResponse.status).toBe(200);
    expect(draftApiResponse.body.facts_budget.items.length).toBeGreaterThanOrEqual(10);
  });

  it('returns 422 when required sheet is missing', async () => {
    const token = await loginReporter();

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('其他表');
    const buffer = await workbook.xlsx.writeBuffer();

    const uploadResponse = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('year', '2024')
      .attach('file', buffer, 'missing_sheet.xlsx');

    const parseResponse = await request(app)
      .post(`/api/uploads/${uploadResponse.body.upload_id}/parse`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(parseResponse.status).toBe(422);
    expect(parseResponse.body.code).toBe('MISSING_SHEET');
    expect(parseResponse.body.details.evidence.sheet_name).toBe('预算汇总');
  });
});
