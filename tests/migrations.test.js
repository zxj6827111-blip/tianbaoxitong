const db = require('../src/db');
const { migrateUp, migrateDown } = require('./helpers/migrations');

describe('migrations', () => {
  beforeAll(() => {
    migrateUp();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it('creates key tables and constraints', async () => {
    const tables = [
      'org_department',
      'org_unit',
      'users',
      'roles',
      'user_roles',
      'report_draft',
      'report_version',
      'audit_log'
    ];

    for (const table of tables) {
      const result = await db.query('SELECT to_regclass($1) as table_name', [`public.${table}`]);
      expect(result.rows[0].table_name).toBe(table);
    }

    const orgUnitUnique = await db.query(
      `SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'org_unit'::regclass
         AND contype = 'u'
         AND pg_get_constraintdef(oid) LIKE '%(code)%'`
    );
    expect(orgUnitUnique.rowCount).toBeGreaterThan(0);

    const usersUnique = await db.query(
      `SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'users'::regclass
         AND contype = 'u'
         AND pg_get_constraintdef(oid) LIKE '%(email)%'`
    );
    expect(usersUnique.rowCount).toBeGreaterThan(0);
  });

  it('can rollback the latest migration', async () => {
    migrateDown();
    migrateDown();
    migrateDown();

    const result = await db.query('SELECT to_regclass($1) as table_name', ['public.org_department']);
    expect(result.rows[0].table_name).toBeNull();

    migrateUp();
  });
});
