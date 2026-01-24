process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../src/services/reportRenderer', () => ({
  renderPdf: jest.fn().mockImplementation(async () => {
    const fs = require('node:fs/promises');
    await fs.writeFile('mock.pdf', 'dummy pdf content');
    return { pdfPath: 'mock.pdf', pdfSha: 'mocksha' };
  })
}));
jest.mock('../src/services/reportExcelService', () => ({
  renderExcel: jest.fn().mockImplementation(async () => {
    const fs = require('node:fs/promises');
    await fs.writeFile('mock.xlsx', 'dummy excel content');
    return { excelPath: 'mock.xlsx', excelSha: 'mocksha' };
  })
}));

const request = require('supertest');
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
    ['D300', 'Report Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, 'U300', 'Report Unit']
  );

  await db.query(
    `INSERT INTO history_actuals
      (unit_id, year, stage, key, value_numeric)
     VALUES
      ($1, $2, $3, $4, $5)`,
    [unit.rows[0].id, 2023, 'FINAL', 'fiscal_grant_expenditure_personnel_prev', 100]
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['report@example.com', passwordHash, 'Reporter', unit.rows[0].id, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['reporter']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );
};

const loginReporter = async () => {
  await seedReporter();
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'report@example.com', password: 'secret' });

  return response.body.token;
};

const uploadAndParse = async (token) => {
  const buffer = await generateSampleUnitBuffer({ year: 2024 });
  const uploadResponse = await request(app)
    .post('/api/uploads')
    .set('Authorization', `Bearer ${token}`)
    .field('year', '2024')
    .attach('file', buffer, 'sample_unit.xlsx');

  const parseResponse = await request(app)
    .post(`/api/uploads/${uploadResponse.body.upload_id}/parse`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  return parseResponse.body.draft_id;
};

describe('report generation', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(`
      TRUNCATE history_actuals, manual_inputs, report_version, validation_issues, line_items_reason,
        facts_budget, parsed_cells, report_draft, upload_job,
        user_roles, users, org_unit, org_department
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('blocks generation when fatal issues exist', async () => {
    const token = await loginReporter();
    const draftId = await uploadAndParse(token);

    const generateResponse = await request(app)
      .post(`/api/drafts/${draftId}/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(generateResponse.status).toBe(400);
    expect(generateResponse.body.code).toBe('FATAL_VALIDATION');

    const reportVersionResult = await db.query(
      'SELECT COUNT(*) AS count FROM report_version WHERE draft_id = $1',
      [draftId]
    );
    expect(Number(reportVersionResult.rows[0].count)).toBe(0);
  });

  it('generates report version and allows downloads', async () => {
    const token = await loginReporter();
    const draftId = await uploadAndParse(token);

    await db.query(
      `INSERT INTO manual_inputs (draft_id, key, value_text)
       VALUES ($1, 'unit_full_name', 'Report Unit'),
              ($1, 'report_contact', '13800000000')`,
      [draftId]
    );

    const generateResponse = await request(app)
      .post(`/api/drafts/${draftId}/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(generateResponse.status).toBe(201);
    expect(generateResponse.body.report_version_id).toBeTruthy();

    const reportVersionId = generateResponse.body.report_version_id;

    const pdfResponse = await request(app)
      .get(`/api/report_versions/${reportVersionId}/download/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true);
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers['content-type']).toContain('application/pdf');
    expect(pdfResponse.body.length).toBeGreaterThan(0);

    const excelResponse = await request(app)
      .get(`/api/report_versions/${reportVersionId}/download/excel`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true);
    expect(excelResponse.status).toBe(200);
    expect(excelResponse.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(excelResponse.body.length).toBeGreaterThan(0);

    const versionResult = await db.query(
      `SELECT template_version, draft_snapshot_hash, is_frozen
       FROM report_version
       WHERE id = $1`,
      [reportVersionId]
    );

    expect(versionResult.rowCount).toBe(1);
    expect(versionResult.rows[0].template_version).toBe('shanghai_v1');
    expect(versionResult.rows[0].draft_snapshot_hash).toBeTruthy();
    expect(versionResult.rows[0].is_frozen).toBe(true);
  });
});
