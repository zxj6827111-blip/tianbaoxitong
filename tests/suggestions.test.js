process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { migrateUp } = require('./helpers/migrations');
const { hashPassword } = require('../src/auth/password');

const createDepartmentAndUnit = async ({ unitCode = 'U700', departmentCode = 'D700' } = {}) => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    [departmentCode, 'Suggestion Department']
  );

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [department.rows[0].id, unitCode, 'Suggestion Unit']
  );

  return { deptId: department.rows[0].id, unitId: unit.rows[0].id };
};

const seedUserWithRole = async ({ roleName, unitId, deptId }) => {
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

const createDraft = async ({ unitId, year, userId }) => {
  const draft = await db.query(
    `INSERT INTO report_draft (unit_id, year, template_version, status, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [unitId, year, 'shanghai_v1', 'DRAFT', userId]
  );
  return draft.rows[0].id;
};

describe('correction suggestions B mode', () => {
  beforeAll(async () => {
    await migrateUp();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE correction_suggestion,
                history_actuals,
                report_version,
                report_draft,
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

  it('uses suggestion value for lookup after submission', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit();
    await seedUserWithRole({ roleName: 'reporter', unitId, deptId });
    const token = await login('reporter@example.com');

    await db.query(
      `INSERT INTO history_actuals (unit_id, year, stage, key, value_numeric)
       VALUES ($1, $2, $3, $4, $5)`,
      [unitId, 2024, 'FINAL', 'budget_revenue_total', 10]
    );

    const draftId = await createDraft({ unitId, year: 2024, userId: null });

    const suggestionResponse = await request(app)
      .post(`/api/drafts/${draftId}/suggestions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'budget_revenue_total',
        old_value: 10,
        suggest_value: 20,
        reason: '调整为最新执行口径'
      });

    expect(suggestionResponse.status).toBe(201);

    const lookupResponse = await request(app)
      .get(`/api/history/lookup?unit_id=${unitId}&year=2024&keys=budget_revenue_total`)
      .set('Authorization', `Bearer ${token}`);

    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.body.values.budget_revenue_total).toBe(20);
  });

  it('approves suggestion and writes to history_actuals', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U701', departmentCode: 'D701' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const draftId = await createDraft({ unitId, year: 2024, userId: null });

    const suggestion = await db.query(
      `INSERT INTO correction_suggestion
        (draft_id, unit_id, department_id, year, key, suggest_value_wanyuan, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING id`,
      [draftId, unitId, deptId, 2024, 'budget_revenue_total', 30]
    );

    const approveResponse = await request(app)
      .post(`/api/admin/suggestions/${suggestion.rows[0].id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(approveResponse.status).toBe(200);

    const actual = await db.query(
      `SELECT value_numeric, provenance_source, source_suggestion_id
       FROM history_actuals
       WHERE unit_id = $1 AND year = $2 AND key = $3 AND stage = 'FINAL'`,
      [unitId, 2024, 'budget_revenue_total']
    );

    expect(Number(actual.rows[0].value_numeric)).toBe(30);
    expect(actual.rows[0].provenance_source).toBe('suggestion');
    expect(actual.rows[0].source_suggestion_id).toBe(suggestion.rows[0].id);
  });

  it('rejects suggestion without updating history_actuals', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U702', departmentCode: 'D702' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const draftId = await createDraft({ unitId, year: 2024, userId: null });
    const suggestion = await db.query(
      `INSERT INTO correction_suggestion
        (draft_id, unit_id, department_id, year, key, suggest_value_wanyuan, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING id`,
      [draftId, unitId, deptId, 2024, 'budget_revenue_total', 40]
    );

    const rejectResponse = await request(app)
      .post(`/api/admin/suggestions/${suggestion.rows[0].id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(rejectResponse.status).toBe(200);

    const countResult = await db.query(
      `SELECT COUNT(*) AS count
       FROM history_actuals
       WHERE unit_id = $1 AND year = $2 AND key = $3`,
      [unitId, 2024, 'budget_revenue_total']
    );
    expect(Number(countResult.rows[0].count)).toBe(0);
  });

  it('keeps report_version provenance unchanged after approval', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U703', departmentCode: 'D703' });
    await seedUserWithRole({ roleName: 'admin', unitId, deptId });
    const adminToken = await login('admin@example.com');

    const draftId = await createDraft({ unitId, year: 2024, userId: null });
    const suggestion = await db.query(
      `INSERT INTO correction_suggestion
        (draft_id, unit_id, department_id, year, key, suggest_value_wanyuan, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING id`,
      [draftId, unitId, deptId, 2024, 'budget_revenue_total', 50]
    );

    await db.query(
      `INSERT INTO report_version
        (draft_id, version_no, template_version, provenance_source, suggestion_status, is_frozen)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [draftId, 1, 'shanghai_v1', 'suggestion', 'pending', true]
    );

    const approveResponse = await request(app)
      .post(`/api/admin/suggestions/${suggestion.rows[0].id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(approveResponse.status).toBe(200);

    const report = await db.query(
      `SELECT provenance_source, suggestion_status
       FROM report_version
       WHERE draft_id = $1 AND version_no = 1`,
      [draftId]
    );

    expect(report.rows[0].provenance_source).toBe('suggestion');
    expect(report.rows[0].suggestion_status).toBe('pending');
  });

  it('rejects non-admin access to admin suggestions list', async () => {
    const { deptId, unitId } = await createDepartmentAndUnit({ unitCode: 'U704', departmentCode: 'D704' });
    await seedUserWithRole({ roleName: 'viewer', unitId, deptId });
    const token = await login('viewer@example.com');

    const response = await request(app)
      .get('/api/admin/suggestions?status=pending')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});
