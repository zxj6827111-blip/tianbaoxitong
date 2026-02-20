process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const fs = require('node:fs/promises');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/auth/password');
const { migrateUp } = require('./helpers/migrations');
const { ensureReportDir, getReportFilePath } = require('../src/services/reportStorage');

const createDepartmentAndUnit = async ({ deptCode, unitCode, deptName, unitName }) => {
  const deptResult = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    [deptCode, deptName]
  );
  const deptId = deptResult.rows[0].id;

  const unitResult = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, unitCode, unitName]
  );

  return {
    departmentId: deptId,
    unitId: unitResult.rows[0].id
  };
};

const seedUserWithRole = async ({ email, roleName, unitId, departmentId }) => {
  const passwordHash = await hashPassword('secret');
  const userResult = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [email, passwordHash, email, unitId, departmentId]
  );

  const roleResult = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [userResult.rows[0].id, roleResult.rows[0].id]
  );

  return userResult.rows[0].id;
};

const login = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });
  return response.body.token;
};

describe('security access controls', () => {
  beforeAll(async () => {
    await migrateUp();
    await ensureReportDir();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE report_version, report_draft, upload_job, history_actuals,
        user_roles, users, org_unit, org_department
       RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('forbids cross-unit history lookup for non-admin users', async () => {
    const tenantA = await createDepartmentAndUnit({
      deptCode: 'D_SEC_A',
      unitCode: 'U_SEC_A',
      deptName: 'Security Dept A',
      unitName: 'Security Unit A'
    });
    const tenantB = await createDepartmentAndUnit({
      deptCode: 'D_SEC_B',
      unitCode: 'U_SEC_B',
      deptName: 'Security Dept B',
      unitName: 'Security Unit B'
    });

    await seedUserWithRole({
      email: 'sec_reporter_a@example.com',
      roleName: 'reporter',
      unitId: tenantA.unitId,
      departmentId: tenantA.departmentId
    });
    await seedUserWithRole({
      email: 'sec_reporter_b@example.com',
      roleName: 'reporter',
      unitId: tenantB.unitId,
      departmentId: tenantB.departmentId
    });

    await db.query(
      `INSERT INTO history_actuals (unit_id, year, stage, key, value_numeric)
       VALUES ($1, 2025, 'FINAL', 'budget_revenue_total', 321.00)`,
      [tenantA.unitId]
    );

    const tokenB = await login('sec_reporter_b@example.com');
    const response = await request(app)
      .get(`/api/history/lookup?unit_id=${tenantA.unitId}&year=2025&keys=budget_revenue_total`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('forbids cross-unit upload parse', async () => {
    const tenantA = await createDepartmentAndUnit({
      deptCode: 'D_UP_A',
      unitCode: 'U_UP_A',
      deptName: 'Upload Dept A',
      unitName: 'Upload Unit A'
    });
    const tenantB = await createDepartmentAndUnit({
      deptCode: 'D_UP_B',
      unitCode: 'U_UP_B',
      deptName: 'Upload Dept B',
      unitName: 'Upload Unit B'
    });

    const userA = await seedUserWithRole({
      email: 'upload_owner@example.com',
      roleName: 'reporter',
      unitId: tenantA.unitId,
      departmentId: tenantA.departmentId
    });
    await seedUserWithRole({
      email: 'upload_other@example.com',
      roleName: 'reporter',
      unitId: tenantB.unitId,
      departmentId: tenantB.departmentId
    });

    const uploadResult = await db.query(
      `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status, uploaded_by)
       VALUES ($1, 2025, 'unit', 'owner.xlsx', 'hash-owner', 'UPLOADED', $2)
       RETURNING id`,
      [tenantA.unitId, userA]
    );

    const tokenB = await login('upload_other@example.com');
    const response = await request(app)
      .post(`/api/uploads/${uploadResult.rows[0].id}/parse`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send();

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('forbids report download for unauthorized users', async () => {
    const tenantA = await createDepartmentAndUnit({
      deptCode: 'D_RPT_A',
      unitCode: 'U_RPT_A',
      deptName: 'Report Dept A',
      unitName: 'Report Unit A'
    });
    const tenantB = await createDepartmentAndUnit({
      deptCode: 'D_RPT_B',
      unitCode: 'U_RPT_B',
      deptName: 'Report Dept B',
      unitName: 'Report Unit B'
    });

    const userA = await seedUserWithRole({
      email: 'report_owner@example.com',
      roleName: 'reporter',
      unitId: tenantA.unitId,
      departmentId: tenantA.departmentId
    });
    await seedUserWithRole({
      email: 'report_other@example.com',
      roleName: 'reporter',
      unitId: tenantB.unitId,
      departmentId: tenantB.departmentId
    });

    const uploadResult = await db.query(
      `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status, uploaded_by)
       VALUES ($1, 2025, 'unit', 'owner.xlsx', 'hash-report', 'PARSED', $2)
       RETURNING id`,
      [tenantA.unitId, userA]
    );
    const draftResult = await db.query(
      `INSERT INTO report_draft (unit_id, year, template_version, status, created_by, upload_id)
       VALUES ($1, 2025, 'shanghai_v1', 'GENERATED', $2, $3)
       RETURNING id`,
      [tenantA.unitId, userA, uploadResult.rows[0].id]
    );

    const reportVersionId = '11111111-1111-4111-8111-111111111111';
    const pdfPath = getReportFilePath({ reportVersionId, suffix: 'report.pdf' });
    const excelPath = getReportFilePath({ reportVersionId, suffix: 'report.xlsx' });
    await fs.writeFile(pdfPath, 'pdf');
    await fs.writeFile(excelPath, 'excel');

    await db.query(
      `INSERT INTO report_version
         (id, draft_id, version_no, generated_at, template_version, draft_snapshot_hash, pdf_path, excel_path, is_frozen)
       VALUES
         ($1, $2, 1, NOW(), 'shanghai_v1', 'snapshot', $3, $4, true)`,
      [reportVersionId, draftResult.rows[0].id, pdfPath, excelPath]
    );

    const tokenB = await login('report_other@example.com');
    const response = await request(app)
      .get(`/api/report_versions/${reportVersionId}/download/pdf`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('forbids reporter from reading admin archive text content endpoint', async () => {
    const tenantA = await createDepartmentAndUnit({
      deptCode: 'D_ARC_A',
      unitCode: 'U_ARC_A',
      deptName: 'Archive Dept A',
      unitName: 'Archive Unit A'
    });
    const tenantB = await createDepartmentAndUnit({
      deptCode: 'D_ARC_B',
      unitCode: 'U_ARC_B',
      deptName: 'Archive Dept B',
      unitName: 'Archive Unit B'
    });

    await seedUserWithRole({
      email: 'archive_reporter_a@example.com',
      roleName: 'reporter',
      unitId: tenantA.unitId,
      departmentId: tenantA.departmentId
    });
    await seedUserWithRole({
      email: 'archive_reporter_b@example.com',
      roleName: 'reporter',
      unitId: tenantB.unitId,
      departmentId: tenantB.departmentId
    });

    await db.query(
      `INSERT INTO org_dept_text_content (department_id, year, report_type, category, content_text)
       VALUES ($1, 2025, 'BUDGET', 'EXPLANATION', 'sensitive archive text')`,
      [tenantA.departmentId]
    );

    const tokenB = await login('archive_reporter_b@example.com');
    const response = await request(app)
      .get(`/api/admin/archives/text-content/${tenantA.departmentId}/2025/EXPLANATION?report_type=BUDGET`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
