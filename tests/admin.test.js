process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const ExcelJS = require('exceljs');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');

const seedAdminUser = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D001', 'Finance Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, 'U000', 'Admin Unit']
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['admin@example.com', passwordHash, 'Admin', unit.rows[0].id, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['admin']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );
};

const login = async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@example.com', password: 'secret' });

  return response.body.token;
};

const seedUserWithRole = async ({ email, roleName, unitId, departmentId }) => {
  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [email, passwordHash, email, unitId || null, departmentId || null]
  );
  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );
  return user.rows[0].id;
};

const loginAs = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });
  return response.body.token;
};

describe('admin management endpoints', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE correction_suggestion,
                history_actuals,
                base_info_version,
                report_version,
                report_draft,
                audit_log,
                user_roles,
                users,
                org_unit,
                org_department
       RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('aggregates department counters with empty departments', async () => {
    await seedAdminUser();

    const deptA = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D100', 'Dept A']
    );
    const deptB = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D200', 'Dept B']
    );

    const unitOne = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [deptA.rows[0].id, 'U101', 'Unit One']
    );
    const unitTwo = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [deptA.rows[0].id, 'U102', 'Unit Two']
    );
    const unitThree = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [deptA.rows[0].id, 'U103', 'Unit Three']
    );

    await db.query(
      `INSERT INTO history_actuals (unit_id, year, stage, key, value_numeric, is_locked)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [unitOne.rows[0].id, 2024, 'FINAL', 'k1', 10.0, false]
    );
    await db.query(
      `INSERT INTO history_actuals (unit_id, year, stage, key, value_numeric, is_locked)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [unitThree.rows[0].id, 2024, 'FINAL', 'k1', 12.0, true]
    );
    await db.query(
      `INSERT INTO base_info_version (scope_type, scope_id, year, version_no, content_json, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['unit', unitOne.rows[0].id, 2024, 1, { name: 'Unit One' }, true]
    );
    await db.query(
      `INSERT INTO correction_suggestion (unit_id, year, key, status)
       VALUES ($1, $2, $3, $4)`,
      [unitOne.rows[0].id, 2024, 'k1', 'PENDING']
    );

    const token = await login();
    const response = await request(app)
      .get('/api/admin/departments?year=2024')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const deptAData = response.body.departments.find((dept) => dept.id === deptA.rows[0].id);
    const deptBData = response.body.departments.find((dept) => dept.id === deptB.rows[0].id);

    expect(deptAData.total_units).toBe(3);
    expect(deptAData.missing_archive).toBe(1);
    expect(deptAData.pending_suggestions).toBe(1);
    expect(deptAData.missing_baseinfo).toBe(2);
    expect(deptAData.todo_units).toBe(3);

    expect(deptBData.total_units).toBe(0);
    expect(deptBData.todo_units).toBe(0);
  });

  it('paginates unit list and handles last page', async () => {
    await seedAdminUser();

    const dept = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D300', 'Dept C']
    );

    const unitIds = [];
    for (const [index, code] of ['U201', 'U202', 'U203'].entries()) {
      const unit = await db.query(
        `INSERT INTO org_unit (department_id, code, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [dept.rows[0].id, code, `Unit ${index + 1}`]
      );
      unitIds.push(unit.rows[0].id);
    }

    await db.query(
      `INSERT INTO history_actuals (unit_id, year, stage, key, value_numeric)
       VALUES ($1, $2, $3, $4, $5)`,
      [unitIds[0], 2024, 'FINAL', 'k1', 9.0]
    );

    const token = await login();
    const response = await request(app)
      .get(`/api/admin/units?department_id=${dept.rows[0].id}&page=2&pageSize=2&year=2024`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.units).toHaveLength(1);

    const filterResponse = await request(app)
      .get(`/api/admin/units?department_id=${dept.rows[0].id}&page=1&pageSize=10&filter=missingArchive&year=2024`)
      .set('Authorization', `Bearer ${token}`);

    expect(filterResponse.status).toBe(200);
    expect(filterResponse.body.units.length).toBe(2);
  });

  it('returns report generation metrics for admin users', async () => {
    await seedAdminUser();

    const token = await login();
    const response = await request(app)
      .get('/api/admin/system/report-generation-metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.metrics).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        concurrency_limit: expect.any(Number),
        queue_timeout_ms: expect.any(Number),
        queue_poll_ms: expect.any(Number)
      }),
      queue: expect.objectContaining({
        waiting_now_local: expect.any(Number),
        waiting_peak_local: expect.any(Number),
        running_now_local: expect.any(Number),
        running_peak_local: expect.any(Number)
      }),
      totals: expect.objectContaining({
        jobs: expect.any(Number),
        success: expect.any(Number),
        failed: expect.any(Number),
        timeout: expect.any(Number),
        failure_rate: expect.any(Number),
        avg_wait_ms: expect.any(Number),
        avg_duration_ms: expect.any(Number)
      }),
      by_operation: expect.any(Object)
    }));
    expect(response.body.metrics.queue).toHaveProperty('running_now_global');
  });

  it('rejects invalid reorder type on admin org endpoint', async () => {
    await seedAdminUser();

    const token = await login();
    const response = await request(app)
      .post('/api/admin/org/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'invalid-type',
        items: [{ id: '00000000-0000-0000-0000-000000000000', sort_order: 1 }]
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('downloads org import template as xlsx', async () => {
    await seedAdminUser();
    const token = await login();

    const response = await request(app)
      .get('/api/admin/org/template')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const payloadSize = Buffer.isBuffer(response.body)
      ? response.body.length
      : Buffer.byteLength(String(response.text || ''), 'utf8');
    expect(payloadSize).toBeGreaterThan(100);
  });

  it('imports simplified org batch template', async () => {
    await seedAdminUser();
    const token = await login();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    worksheet.addRow(['部门名称', '单位名称', '备注']);
    worksheet.addRow(['测试部门A', '测试单位A1', '']);
    worksheet.addRow(['测试部门A', '测试单位A2', '']);
    worksheet.addRow(['测试部门B', '', '仅创建部门']);
    const buffer = await workbook.xlsx.writeBuffer();

    const response = await request(app)
      .post('/api/admin/org/batch-import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(buffer), 'org-import.xlsx');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.format).toBe('simplified');
    expect(response.body.imported.departments).toBe(2);
    expect(response.body.imported.units).toBe(2);

    const departmentCount = await db.query(`SELECT COUNT(*) AS count FROM org_department WHERE name LIKE '测试部门%'`);
    const unitCount = await db.query(`SELECT COUNT(*) AS count FROM org_unit WHERE name LIKE '测试单位%'`);
    expect(Number(departmentCount.rows[0].count)).toBe(2);
    expect(Number(unitCount.rows[0].count)).toBe(2);
  });

  it('supports admin user CRUD endpoints', async () => {
    await seedAdminUser();
    const token = await login();

    const dept = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D_USER_01', '鐢ㄦ埛娴嬭瘯閮ㄩ棬']
    );
    const unit = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [dept.rows[0].id, 'U_USER_01', '鐢ㄦ埛娴嬭瘯鍗曚綅']
    );

    const createResponse = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'new-user@example.com',
        password: 'secret123',
        display_name: 'new-user',
        role: 'reporter',
        unit_id: unit.rows[0].id,
        managed_unit_ids: [unit.rows[0].id],
        can_create_budget: true,
        can_create_final: false
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.user).toEqual(expect.objectContaining({
      email: 'new-user@example.com',
      role: 'reporter',
      unit_id: unit.rows[0].id,
      managed_unit_ids: [unit.rows[0].id],
      can_create_budget: true,
      can_create_final: false
    }));

    const userId = createResponse.body.user.id;

    const updateResponse = await request(app)
      .put(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        display_name: 'new-user-updated',
        role: 'viewer',
        unit_id: unit.rows[0].id,
        managed_unit_ids: [unit.rows[0].id],
        can_create_budget: false,
        can_create_final: false
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.user.role).toBe('viewer');
    expect(updateResponse.body.user.can_create_budget).toBe(false);
    expect(updateResponse.body.user.can_create_final).toBe(false);

    const listResponse = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.users.some((user) => user.id === userId)).toBe(true);

    const deleteResponse = await request(app)
      .delete(`/api/admin/users/${userId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);
  });

  it('forbids reporter from accessing admin user management endpoint', async () => {
    await seedAdminUser();

    const dept = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D_RP_01', 'Reporter 閮ㄩ棬']
    );
    const unit = await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [dept.rows[0].id, 'U_RP_01', 'Reporter 鍗曚綅']
    );
    await seedUserWithRole({
      email: 'reporter-no-access@example.com',
      roleName: 'reporter',
      unitId: unit.rows[0].id,
      departmentId: dept.rows[0].id
    });

    const reporterToken = await loginAs('reporter-no-access@example.com');
    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${reporterToken}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});

