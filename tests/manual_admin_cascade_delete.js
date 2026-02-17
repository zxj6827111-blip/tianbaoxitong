require('dotenv').config();

// 🔒 安全防护：强制使用测试数据库
if (!process.env.TEST_DATABASE_URL) {
  console.error('🚨 错误: 缺少 TEST_DATABASE_URL 环境变量');
  process.exit(1);
}
process.env.NODE_ENV = 'test';
process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

console.log('DEBUG: JWT_SECRET loaded:', process.env.JWT_SECRET ? 'YES' : 'NO', process.env.JWT_SECRET?.substring(0, 3));
const fs = require('fs');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/auth/password');
const { signToken } = require('../src/auth/jwt');

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
    [`${roleName}_manual_${Date.now()}@example.com`, passwordHash, `${roleName} user`, unitId, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { email: `${roleName}_manual_${Date.now()}@example.com` };
};



async function runTest() {
  console.log('Starting Manual Cascade Delete Test...');
  let adminToken;
  let testDeptId;
  let testUnitId;

  try {
    // Setup Admin
    const timestamp = Date.now();
    // Using simple queries without explicit transaction to avoid complexity
    const deptRes = await db.query(
        `INSERT INTO org_department (code, name) VALUES ($1, $2) RETURNING id`,
        [`ADMIN_D_${timestamp}`, 'Cascade Test Dept']
    );
    const deptId = deptRes.rows[0].id;
    console.log(`[SETUP] Created Admin Dept: ${deptId}`);
    
    const unitRes = await db.query(
        `INSERT INTO org_unit (department_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
        [deptId, `ADMIN_U_${timestamp}`, 'Cascade Test Unit']
    );
    const unitId = unitRes.rows[0].id;

    const passwordHash = await hashPassword('secret');
    const userRes = await db.query(
        `INSERT INTO users (email, password_hash, display_name, unit_id, department_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`admin_manual_${timestamp}@example.com`, passwordHash, 'Admin user', unitId, deptId]
    );
    const userId = userRes.rows[0].id;
    const email = `admin_manual_${timestamp}@example.com`;

    const roleRes = await db.query('SELECT id FROM roles WHERE name = $1', ['admin']);
    await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleRes.rows[0].id]);
    
    console.log(`✅ Admin Setup Complete. Email: ${email}`);
    
    // Bypassing login endpoint to avoid potential env/context issues
    adminToken = signToken({ userId });
    console.log(`✅ Generated Token for user ${userId}`);


    // 1. Create Department
    const targetDeptRes = await request(app)
      .post('/api/admin/org/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Dept', code: `TARGET_DEPT_${timestamp}` });
    
    if (targetDeptRes.statusCode !== 201) throw new Error(`Failed to create dept: ${JSON.stringify(targetDeptRes.body)}`);
    testDeptId = targetDeptRes.body.department.id;
    console.log('✅ Created Department');

    // 2. Create Unit
    const targetUnitRes = await request(app)
      .post('/api/admin/org/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cascade Target Unit', code: `TARGET_UNIT_${timestamp}`, department_id: testDeptId });

    if (targetUnitRes.statusCode !== 201) throw new Error(`Failed to create unit: ${JSON.stringify(targetUnitRes.body)}`);
    testUnitId = targetUnitRes.body.unit.id;
    console.log('✅ Created Unit');

    // 3. Try to delete Dept (should fail)
    const delRes = await request(app)
      .delete(`/api/admin/org/departments/${testDeptId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    if (delRes.statusCode !== 400 || delRes.body.code !== 'DEPARTMENT_HAS_UNITS') {
        throw new Error(`Expected 400 DEPARTMENT_HAS_UNITS but got ${delRes.statusCode} ${JSON.stringify(delRes.body)}`);
    }
    console.log('✅ Correctly blocked delete without force');

    // Debug: Check user existence
    const debugUserCheck = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    console.log(`[DEBUG] User check before force delete: Found ${debugUserCheck.rows.length} rows`);

    // 4. Force Delete Dept
    const forceDelRes = await request(app)
      .delete(`/api/admin/org/departments/${testDeptId}?force=true`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    if (forceDelRes.statusCode !== 200 || !forceDelRes.body.success) {
        throw new Error(`Failed force delete: ${forceDelRes.statusCode} ${JSON.stringify(forceDelRes.body)}`);
    }
    console.log('✅ Force delete successful');

    // 5. Verify Unit is gone
    const unitCheck = await db.query('SELECT * FROM org_unit WHERE id = $1', [testUnitId]);
    if (unitCheck.rows.length !== 0) throw new Error('Unit still exists in DB');
    console.log('✅ Validated Unit is deleted from DB');

    // 6. Verify Dept is gone
    const deptCheck = await db.query('SELECT * FROM org_department WHERE id = $1', [testDeptId]);
    if (deptCheck.rows.length !== 0) throw new Error('Department still exists in DB');
    console.log('✅ Validated Department is deleted from DB');

    console.log('🎉 ALL TESTS PASSED');
    fs.writeFileSync('manual_test_result.log', '🎉 ALL TESTS PASSED');
  } catch (error) {
    console.error('❌ TEST FAILED:', error);
    fs.writeFileSync('manual_test_result.log', `❌ TEST FAILED: ${error.stack || error}`);
  } finally {
    await db.end();
  }
}

runTest();
