require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { migrateUp } = require('../../tests/helpers/migrations');
const { hashPassword } = require('../../src/auth/password');
const { generateSampleUnitBuffer } = require('../gen_sample_unit_xlsx');
const { hashNormalizedPdf } = require('./normalizePdf');

const GOLDEN_DIR = path.resolve(process.cwd(), 'artifacts', 'golden');
const GOLDEN_META_PATH = path.join(GOLDEN_DIR, 'report.json');

const seedReporter = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D200', 'Golden Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, 'U200', 'Golden Unit']
  );

  await db.query(
    `INSERT INTO history_actuals
      (unit_id, year, stage, key, value_numeric)
     VALUES
      ($1, $2, $3, $4, $5)`,
    [unit.rows[0].id, 2023, 'final', 'fiscal_grant_expenditure_personnel_prev', 100]
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['golden@example.com', passwordHash, 'Golden', unit.rows[0].id, deptId]
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
    .send({ email: 'golden@example.com', password: 'secret' });

  return response.body.token;
};

const ensureGoldenDir = async () => {
  await fs.mkdir(GOLDEN_DIR, { recursive: true });
};

const main = async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  await migrateUp();

  await db.query(`
    TRUNCATE history_actuals, manual_inputs, report_version, validation_issues, line_items_reason,
      facts_budget, parsed_cells, report_draft, upload_job,
      user_roles, users, org_unit, org_department
    RESTART IDENTITY CASCADE
  `);

  const token = await loginReporter();
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

  await db.query(
    `INSERT INTO manual_inputs (draft_id, key, value_text)
     VALUES ($1, 'unit_full_name', 'Golden Unit'),
            ($1, 'report_contact', '13800000000')`,
    [parseResponse.body.draft_id]
  );

  const generateResponse = await request(app)
    .post(`/api/drafts/${parseResponse.body.draft_id}/generate`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  if (generateResponse.status !== 201) {
    console.error('Generate failed details:', JSON.stringify(generateResponse.body, null, 2));
    throw new Error(`Generate failed: ${generateResponse.status}`);
  }

  const reportVersionId = generateResponse.body.report_version_id;
  const pdfResponse = await request(app)
    .get(`/api/report_versions/${reportVersionId}/download/pdf`)
    .set('Authorization', `Bearer ${token}`)
    .set('Authorization', `Bearer ${token}`)
    .parse((res, cb) => {
      res.setEncoding('binary');
      res.data = '';
      res.on('data', (chunk) => res.data += chunk);
      res.on('end', () => cb(null, Buffer.from(res.data, 'binary')));
    });

  if (pdfResponse.status !== 200) {
    console.error('PDF download failed:', pdfResponse.status);
    throw new Error(`PDF download failed: ${pdfResponse.status}`);
  }

  await ensureGoldenDir();
  const pdfPath = path.join(GOLDEN_DIR, 'report.pdf');
  await fs.writeFile(pdfPath, pdfResponse.body);
  const pdfHash = await hashNormalizedPdf(pdfPath);

  const excelResponse = await request(app)
    .get(`/api/report_versions/${reportVersionId}/download/excel`)
    .set('Authorization', `Bearer ${token}`)
    .parse((res, cb) => {
      res.setEncoding('binary');
      res.data = '';
      res.on('data', (chunk) => res.data += chunk);
      res.on('end', () => cb(null, Buffer.from(res.data, 'binary')));
    });

  if (excelResponse.status !== 200) {
    console.error('Excel download failed:', excelResponse.status);
    throw new Error(`Excel download failed: ${excelResponse.status}`);
  }


  const excelPath = path.join(GOLDEN_DIR, 'report.xlsx');
  await fs.writeFile(excelPath, excelResponse.body);

  const meta = {
    reportVersionId,
    pdfHash,
    generatedAt: new Date().toISOString()
  };

  await fs.writeFile(GOLDEN_META_PATH, JSON.stringify(meta, null, 2));
  await db.pool.end();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
