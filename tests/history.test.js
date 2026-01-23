process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');
const { generateHistorySampleBuffer } = require('../scripts/gen_history_sample_xlsx');
const { HISTORY_ACTUAL_KEYS } = require('../src/services/historyActualsConfig');

const createDepartmentAndUnit = async ({ unitCode = 'U200', departmentCode = 'D200' } = {}) => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    [departmentCode, 'History Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, unitCode, 'History Unit']
  );

  return { deptId, unitId: unit.rows[0].id };
};

const seedUserWithRole = async ({ roleName, unitId, deptId } = {}) => {
  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [`${roleName}@example.com`, passwordHash, `${roleName} user`, unitId, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );

  return { userId: user.rows[0].id };
};

const login = async (email) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'secret' });

  return response.body.token;
};

describe('history actuals import and lookup', () => {
  beforeAll(() => {
    migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE history_actuals,
                history_import_batch,
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

  it('imports history actuals and creates batch', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U200', departmentCode: 'D200' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const token = await login('admin@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U200',
      year: 2023,
      keys
    });

    const response = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'history.xlsx');

    expect(response.status).toBe(201);
    expect(response.body.batch_id).toBeTruthy();
    expect(response.body.imported_count).toBe(keys.length);

    const batchResult = await db.query(
      'SELECT status FROM history_import_batch WHERE id = $1',
      [response.body.batch_id]
    );
    expect(batchResult.rows[0].status).toBe('IMPORTED');

    const actualsResult = await db.query(
      'SELECT COUNT(*) AS count FROM history_actuals WHERE source_batch_id = $1',
      [response.body.batch_id]
    );
    expect(Number(actualsResult.rows[0].count)).toBe(keys.length);
  });

  it('rejects non-admin import', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U201', departmentCode: 'D201' });
    await seedUserWithRole({ roleName: 'viewer', unitId, deptId });
    const token = await login('viewer@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U201',
      year: 2023,
      keys
    });

    const response = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'history.xlsx');

    expect(response.status).toBe(403);
  });

  it('looks up history values', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U202', departmentCode: 'D202' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    await seedUserWithRole({ roleName: 'viewer', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U202',
      year: 2023,
      keys
    });

    const importResponse = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'history.xlsx');
    expect(importResponse.status).toBe(201);

    const unit = await db.query('SELECT id FROM org_unit WHERE code = $1', ['U202']);
    const viewerToken = await login('viewer@example.com');
    const lookupResponse = await request(app)
      .get(`/api/history/lookup?unit_id=${unit.rows[0].id}&year=2023&keys=${keys.join(',')}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(lookupResponse.status).toBe(200);
    expect(Object.keys(lookupResponse.body.values).length).toBe(keys.length);
    expect(lookupResponse.body.missing_keys.length).toBe(0);
  });

  it('locks batch to prevent overwrite', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U203', departmentCode: 'D203' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const keys = HISTORY_ACTUAL_KEYS.slice(0, 10);
    const buffer = await generateHistorySampleBuffer({
      unitCode: 'U203',
      year: 2023,
      keys
    });

    const importResponse = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'history.xlsx');
    expect(importResponse.status).toBe(201);

    const lockResponse = await request(app)
      .post(`/api/admin/history/batch/${importResponse.body.batch_id}/lock`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(lockResponse.status).toBe(200);

    const retryResponse = await request(app)
      .post('/api/admin/history/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'history.xlsx');

    expect(retryResponse.status).toBe(409);
  });
});
