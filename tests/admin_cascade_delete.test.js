const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/auth/password');

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
  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [`${roleName}_test_${Date.now()}@example.com`, passwordHash, `${roleName} user`, unitId, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { email: `${roleName}_test_${Date.now()}@example.com` };
};

const login = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });
  return response.body.token;
};

describe('Admin Cascade Delete', () => {
  let adminToken;
  let testDeptId;
  let testUnitId;

  beforeAll(async () => {
    // Setup Admin User
    // We need a dummy dept/unit for the admin user to exist
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'ADMIN_U', departmentCode: 'ADMIN_D' });
    const { email } = await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    adminToken = await login(email);
  });

  afterAll(async () => {
    await db.end();
  });

  test('Should create dept and unit, then fail to delete dept without force', async () => {
    // 1. Create Department
    const deptRes = await request(app)
      .post('/api/admin/org/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Dept', code: 'TARGET_DEPT' });
    expect(deptRes.statusCode).toBe(201);
    testDeptId = deptRes.body.department.id;

    // 2. Create Unit
    const unitRes = await request(app)
      .post('/api/admin/org/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Unit', code: 'TARGET_UNIT', department_id: testDeptId });
    expect(unitRes.statusCode).toBe(201);
    testUnitId = unitRes.body.unit.id;

    // 3. Try to delete Dept (should fail)
    const delRes = await request(app)
      .delete(`/api/admin/org/departments/${testDeptId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.statusCode).toBe(400);
    expect(delRes.body.code).toBe('DEPARTMENT_HAS_UNITS');
  });

  test('Should force delete dept and cascade to unit', async () => {
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
