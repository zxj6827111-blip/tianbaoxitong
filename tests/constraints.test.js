const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');

describe('constraints', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE user_roles, users, org_unit, org_department RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('enforces unique org_unit.code', async () => {
    const department = await db.query(
      `INSERT INTO org_department (code, name)
       VALUES ($1, $2)
       RETURNING id`,
      ['D001', 'Finance Department']
    );

    const deptId = department.rows[0].id;

    await db.query(
      `INSERT INTO org_unit (department_id, code, name)
       VALUES ($1, $2, $3)`,
      [deptId, 'U001', 'Unit A']
    );

    await expect(
      db.query(
        `INSERT INTO org_unit (department_id, code, name)
         VALUES ($1, $2, $3)`,
        [deptId, 'U001', 'Unit B']
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces unique users.email', async () => {
    const passwordHash = await hashPassword('secret');

    await db.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)`,
      ['user@example.com', passwordHash, 'User A']
    );

    await expect(
      db.query(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3)`,
        ['user@example.com', passwordHash, 'User B']
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});
