process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/auth/password');
const { migrateUp } = require('./helpers/migrations');

const createDepartmentAndUnit = async ({ unitCode = 'U_TEST', departmentCode = 'D_TEST' } = {}) => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    [departmentCode, 'Cascade Test Dept']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, unitCode, 'Cascade Test Unit']
  );

  return { deptId, unitId: unit.rows[0].id };
};

const seedUserWithRole = async ({ roleName, unitId, deptId } = {}) => {
  const email = `${roleName}_test_${Date.now()}@example.com`;
  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [email, passwordHash, `${roleName} user`, unitId, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { email };
};

const login = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });
  return response.body.token;
};

describe('Admin Cascade Delete', () => {
  let adminToken;

  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE correction_suggestion,
                history_actuals,
                report_version,
                validation_issues,
                line_items_reason,
                manual_inputs,
                facts_budget,
                parsed_cells,
                report_draft,
                upload_job,
                audit_log,
                user_roles,
                users,
                org_unit,
                org_department
       RESTART IDENTITY CASCADE`
    );

    // Setup Admin User
    // We need a dummy dept/unit for the admin user to exist
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'ADMIN_U', departmentCode: 'ADMIN_D' });
    const { email } = await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    adminToken = await login(email);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  test('Should create dept and unit, then fail to delete dept without force', async () => {
    // 1. Create Department
    const deptRes = await request(app)
      .post('/api/admin/org/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Dept', code: 'TARGET_DEPT' });
    expect(deptRes.statusCode).toBe(201);
    const testDeptId = deptRes.body.department.id;

    // 2. Create Unit
    const unitRes = await request(app)
      .post('/api/admin/org/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Unit', code: 'TARGET_UNIT', department_id: testDeptId });
    expect(unitRes.statusCode).toBe(201);

    // 3. Try to delete Dept (should fail)
    const delRes = await request(app)
      .delete(`/api/admin/org/departments/${testDeptId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.statusCode).toBe(400);
    expect(delRes.body.code).toBe('DEPARTMENT_HAS_UNITS');
  });

  test('Should force delete dept and cascade to unit', async () => {
    const deptRes = await request(app)
      .post('/api/admin/org/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Dept 2', code: 'TARGET_DEPT_2' });
    expect(deptRes.statusCode).toBe(201);
    const testDeptId = deptRes.body.department.id;

    const unitRes = await request(app)
      .post('/api/admin/org/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Unit 2', code: 'TARGET_UNIT_2', department_id: testDeptId });
    expect(unitRes.statusCode).toBe(201);
    const testUnitId = unitRes.body.unit.id;

    // 4. Force Delete Dept
    const forceDelRes = await request(app)
      .delete(`/api/admin/org/departments/${testDeptId}?force=true`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(forceDelRes.statusCode).toBe(200);
    expect(forceDelRes.body.success).toBe(true);

    // 5. Verify Unit is gone
    const unitCheck = await db.query('SELECT * FROM org_unit WHERE id = $1', [testUnitId]);
    expect(unitCheck.rows.length).toBe(0);

    // 6. Verify Dept is gone
    const deptCheck = await db.query('SELECT * FROM org_department WHERE id = $1', [testDeptId]);
    expect(deptCheck.rows.length).toBe(0);
  });
});
