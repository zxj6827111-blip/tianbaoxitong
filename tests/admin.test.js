process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
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

describe('admin management endpoints', () => {
  beforeAll(() => {
    migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE correction_suggestion,
                history_actuals,
                base_info_version,
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
    expect(deptAData.missing_baseinfo).toBe(1);
    expect(deptAData.todo_units).toBe(2);

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
});
