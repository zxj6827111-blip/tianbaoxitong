require('dotenv').config();

// 🔒 安全防护：强制使用测试数据库，防止误操作正式库
if (!process.env.TEST_DATABASE_URL) {
  console.error('🚨 错误: 缺少 TEST_DATABASE_URL 环境变量');
  process.exit(1);
}
process.env.NODE_ENV = 'test';
process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const fs = require('node:fs/promises');
const path = require('node:path');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { migrateUp } = require('../../tests/helpers/migrations');
const { hashPassword } = require('../../src/auth/password');
const { generateSampleUnitBuffer } = require('../gen_sample_unit_xlsx');
const { hashNormalizedPdf } = require('./normalizePdf');
const { resetDb } = require('../../tests/helpers/dbUtils');

const GOLDEN_DIR = path.resolve(process.cwd(), 'artifacts', 'golden');
const GOLDEN_META_PATH = path.join(GOLDEN_DIR, 'report.json');
const MANUAL_REASON_TEXT = '根据年度重点任务和资金使用安排，结合历史执行情况测算后据实填报。';
const REQUIRED_MANUAL_TEXTS = {
  unit_full_name: 'Golden Unit',
  report_contact: '13800000000',
  main_functions: '承担部门预算编制、执行管理和绩效跟踪等工作，保障年度重点任务落实。',
  organizational_structure: '单位设置综合管理、财务管理和业务执行等岗位，职责分工明确。',
  glossary: '一般公共预算指依法编制并执行的财政收支预算；财政拨款收入指财政安排的资金来源。',
  budget_change_reason: '预算增减主要受年度政策任务调整、项目支出结构优化和执行节奏变化影响。',
  state_owned_assets: '国有资产配置与使用总体规范，台账完整，资产状态与业务需求匹配。',
  project_overview: '项目围绕提升公共服务能力开展，覆盖组织实施、过程管理和结果评估。',
  project_basis: '依据年度工作计划、财政预算管理要求及相关业务制度立项并实施。',
  project_subject: '由单位业务部门牵头实施，财务与综合部门协同推进并跟踪执行。',
  project_plan: '按照准备、执行、复盘三个阶段推进，明确里程碑节点与责任分工。',
  project_cycle: '项目实施周期为一个预算年度，按月度监控、按季度评估。',
  project_budget_arrangement: '年度预算按项目进度分批安排，执行中同步开展绩效监控和偏差纠偏。',
  project_performance_goal: '实现资金使用合规、任务按期完成、服务质量提升和绩效目标达成。'
};

const seedReporter = async () => {
  const department = await db.query(
    `INSERT INTO org_department (code, name)
     VALUES ($1, $2)
     RETURNING id`,
    ['D200', 'Golden Department']
  );
  const deptId = department.rows[0].id;

  const unit = await db.query(
    `INSERT INTO org_unit (department_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [deptId, 'U200', 'Golden Unit']
  );

  await db.query(
    `INSERT INTO history_actuals
      (unit_id, year, stage, key, value_numeric)
     VALUES
      ($1, $2, $3, $4, $5)`,
    [unit.rows[0].id, 2023, 'FINAL', 'fiscal_grant_expenditure_personnel_prev', 100]
  );

  const passwordHash = await hashPassword('secret');
  const user = await db.query(
    `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    ['golden@example.com', passwordHash, 'Golden', unit.rows[0].id, deptId]
  );

  const role = await db.query('SELECT id FROM roles WHERE name = $1', ['reporter']);
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)`,
    [user.rows[0].id, role.rows[0].id]
  );
};

const loginReporter = async () => {
  await seedReporter();
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'golden@example.com', password: 'secret' });

  return response.body.token;
};

const seedRequiredManualInputs = async ({ draftId }) => {
  for (const [key, valueText] of Object.entries(REQUIRED_MANUAL_TEXTS)) {
    await db.query(
      `INSERT INTO manual_inputs (draft_id, key, value_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (draft_id, key)
       DO UPDATE SET
         value_text = EXCLUDED.value_text,
         updated_at = now()`,
      [draftId, key, valueText]
    );
  }
};

const seedLineItemReasons = async ({ token, draftId }) => {
  const lineItemsResponse = await request(app)
    .get(`/api/drafts/${draftId}/line-items`)
    .set('Authorization', `Bearer ${token}`);

  if (lineItemsResponse.status !== 200) {
    throw new Error(`Line items fetch failed: ${lineItemsResponse.status}`);
  }

  const items = Array.isArray(lineItemsResponse.body?.items) ? lineItemsResponse.body.items : [];
  if (items.length === 0) {
    return;
  }

  const patchPayload = items.map((item) => ({
    item_key: item.item_key,
    reason_text: MANUAL_REASON_TEXT,
    order_no: Number.isFinite(Number(item.order_no)) ? Number(item.order_no) : 0
  }));

  const patchResponse = await request(app)
    .patch(`/api/drafts/${draftId}/line-items`)
    .set('Authorization', `Bearer ${token}`)
    .send({ items: patchPayload });

  if (patchResponse.status !== 200) {
    throw new Error(`Line items patch failed: ${patchResponse.status}`);
  }
};

const prepareDraftForGeneration = async ({ token, draftId }) => {
  await seedRequiredManualInputs({ draftId });
  await seedLineItemReasons({ token, draftId });

  const validateResponse = await request(app)
    .post(`/api/drafts/${draftId}/validate`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  if (validateResponse.status !== 200) {
    throw new Error(`Validate failed: ${validateResponse.status}`);
  }

  if (Number(validateResponse.body?.fatal_count || 0) > 0) {
    throw new Error(`Validate returned fatal issues: ${validateResponse.body.fatal_count}`);
  }

  const submitResponse = await request(app)
    .post(`/api/drafts/${draftId}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  if (submitResponse.status !== 200) {
    throw new Error(`Submit failed: ${submitResponse.status}`);
  }

  const previewResponse = await request(app)
    .post(`/api/drafts/${draftId}/preview`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  if (previewResponse.status !== 201) {
    throw new Error(`Preview failed: ${previewResponse.status}`);
  }
};

const main = async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  // await resetDb(); // migrateUp calls resetDb
  await migrateUp();

  const metaText = await fs.readFile(GOLDEN_META_PATH, 'utf8');
  const meta = JSON.parse(metaText);

  await db.query(`
    TRUNCATE history_actuals, manual_inputs, report_version, validation_issues, line_items_reason,
      facts_budget, parsed_cells, report_draft, upload_job,
      user_roles, users, org_unit, org_department
    RESTART IDENTITY CASCADE
  `);

  const token = await loginReporter();
  const buffer = await generateSampleUnitBuffer({ year: 2024 });

  const uploadResponse = await request(app)
    .post('/api/uploads')
    .set('Authorization', `Bearer ${token}`)
    .field('year', '2024')
    .attach('file', buffer, 'sample_unit.xlsx');

  const parseResponse = await request(app)
    .post(`/api/uploads/${uploadResponse.body.upload_id}/parse`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  await prepareDraftForGeneration({
    token,
    draftId: parseResponse.body.draft_id
  });

  const generateResponse = await request(app)
    .post(`/api/drafts/${parseResponse.body.draft_id}/generate`)
    .set('Authorization', `Bearer ${token}`)
    .send();

  if (generateResponse.status !== 201) {
    throw new Error(`Generate failed: ${generateResponse.status}`);
  }

  const reportVersionId = generateResponse.body.report_version_id;
  const pdfResponse = await request(app)
    .get(`/api/report_versions/${reportVersionId}/download/pdf`)
    .set('Authorization', `Bearer ${token}`)
    .set('Authorization', `Bearer ${token}`)
    .parse((res, cb) => {
      res.setEncoding('binary');
      res.data = '';
      res.on('data', (chunk) => res.data += chunk);
      res.on('end', () => cb(null, Buffer.from(res.data, 'binary')));
    });

  await fs.mkdir(GOLDEN_DIR, { recursive: true });
  const pdfPath = path.join(GOLDEN_DIR, 'report_check.pdf');
  await fs.writeFile(pdfPath, pdfResponse.body);
  const pdfHash = await hashNormalizedPdf(pdfPath);

  if (pdfHash !== meta.pdfHash) {
    throw new Error('Golden PDF hash mismatch');
  }

  await db.pool.end();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
