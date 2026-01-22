process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');

const seedUserWithRole = async (roleName) => {
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
    [deptId, 'U001', 'Unit A']
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['user@example.com', passwordHash, 'User A', unit.rows[0].id, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id };
};

describe('auth', () => {
  beforeAll(() => {
    migrateUp();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE user_roles, users, org_unit, org_department RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('logs in and returns a token', async () => {
    await seedUserWithRole('viewer');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'secret' });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
  });

  it('rejects unauthenticated access', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects access without required role', async () => {
    await seedUserWithRole('viewer');

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'secret' });

    const response = await request(app)
      .get('/api/admin/_demo/departments')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
