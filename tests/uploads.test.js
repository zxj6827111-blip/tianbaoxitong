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

const seedAdmin = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D200', 'Admin Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, 'U200', 'Admin Default Unit']
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['admin@example.com', passwordHash, 'Admin', null, null]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['admin']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id, departmentId: deptId, unitId: unit.rows[0].id };
};

const loginReporter = async () => {
  await seedReporter();
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'reporter@example.com', password: 'secret' });

  return response.body.token;
};

const loginAdmin = async () => {
  const seeded = await seedAdmin();
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@example.com', password: 'secret' });

  return { token: response.body.token, seeded };
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

  it('returns scoped upload options for reporter with managed units', async () => {
    const department = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D_SCOPE_OPT', 'Scope Options Department']
    );
    const deptId = department.rows[0].id;

    const firstUnit = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [deptId, 'U_SCOPE_OPT_A', 'Scope Unit A']
    );
    const secondUnit = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [deptId, 'U_SCOPE_OPT_B', 'Scope Unit B']
    );

    const passwordHash = await hashPassword('secret');
    const userResult = await db.query(
      `INSERT INTO users (email, password_hash, display_name, unit_id, department_id, managed_unit_ids)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[])
       RETURNING id`,
      ['scope-options@example.com', passwordHash, 'scope-options', null, deptId, [firstUnit.rows[0].id, secondUnit.rows[0].id]]
    );
    const role = await db.query('SELECT id FROM roles WHERE name = $1', ['reporter']);
    await db.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)`,
      [userResult.rows[0].id, role.rows[0].id]
    );

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'scope-options@example.com', password: 'secret' });
    expect(loginResponse.status).toBe(200);

    const response = await request(app)
      .get('/api/uploads/scope-options')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.default_department_id).toBe(String(deptId));
    expect(Array.isArray(response.body.departments)).toBe(true);
    expect(Array.isArray(response.body.units)).toBe(true);
    expect(response.body.units.length).toBe(2);
    expect(response.body.units.every((unit) => String(unit.department_id) === String(deptId))).toBe(true);
  });

  it('deletes a draft and removes related upload data', async () => {
    const token = await loginReporter();
    const buffer = await generateSampleUnitBuffer({ year: 2024 });

    const uploadResponse = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('year', '2024')
      .attach('file', buffer, 'sample_unit_delete.xlsx');

    expect(uploadResponse.status).toBe(201);
    const uploadId = uploadResponse.body.upload_id;

    const parseResponse = await request(app)
      .post(`/api/uploads/${uploadId}/parse`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(parseResponse.status).toBe(200);
    const draftId = parseResponse.body.draft_id;

    const deleteResponse = await request(app)
      .delete(`/api/drafts/${draftId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.deleted).toBe(true);
    expect(deleteResponse.body.removed_upload).toBe(true);

    const draftResult = await db.query('SELECT id FROM report_draft WHERE id = $1', [draftId]);
    expect(draftResult.rowCount).toBe(0);

    const uploadResult = await db.query('SELECT id FROM upload_job WHERE id = $1', [uploadId]);
    expect(uploadResult.rowCount).toBe(0);

    const parsedCellsResult = await db.query('SELECT COUNT(*)::int AS count FROM parsed_cells WHERE upload_id = $1', [uploadId]);
    expect(parsedCellsResult.rows[0].count).toBe(0);

    const factsResult = await db.query('SELECT COUNT(*)::int AS count FROM facts_budget WHERE upload_id = $1', [uploadId]);
    expect(factsResult.rows[0].count).toBe(0);

    const manualInputsResult = await db.query('SELECT COUNT(*)::int AS count FROM manual_inputs WHERE draft_id = $1', [draftId]);
    expect(manualInputsResult.rows[0].count).toBe(0);
  }, 20000);

  it('rejects deleting submitted/generate-stage drafts', async () => {
    const token = await loginReporter();
    const buffer = await generateSampleUnitBuffer({ year: 2024 });

    const uploadResponse = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('year', '2024')
      .attach('file', buffer, 'sample_unit_forbidden_delete.xlsx');

    expect(uploadResponse.status).toBe(201);

    const parseResponse = await request(app)
      .post(`/api/uploads/${uploadResponse.body.upload_id}/parse`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(parseResponse.status).toBe(200);
    const draftId = parseResponse.body.draft_id;

    await db.query('UPDATE report_draft SET status = $1 WHERE id = $2', ['SUBMITTED', draftId]);

    const deleteResponse = await request(app)
      .delete(`/api/drafts/${draftId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteResponse.status).toBe(409);
    expect(deleteResponse.body.code).toBe('DRAFT_DELETE_FORBIDDEN');

    const draftResult = await db.query('SELECT status FROM report_draft WHERE id = $1', [draftId]);
    expect(draftResult.rowCount).toBe(1);
    expect(draftResult.rows[0].status).toBe('SUBMITTED');
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

  it('allows admin upload with department only and defaults caliber to department', async () => {
    const { token, seeded } = await loginAdmin();
    const buffer = await generateSampleUnitBuffer({ year: 2024 });

    const uploadResponse = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('year', '2024')
      .field('department_id', seeded.departmentId)
      .attach('file', buffer, 'admin_department_scope.xlsx');

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.upload_id).toBeTruthy();

    const uploadJobResult = await db.query(
      'SELECT unit_id, caliber FROM upload_job WHERE id = $1',
      [uploadResponse.body.upload_id]
    );
    expect(uploadJobResult.rowCount).toBe(1);
    expect(uploadJobResult.rows[0].unit_id).toBe(seeded.unitId);
    expect(uploadJobResult.rows[0].caliber).toBe('department');
  });
});
