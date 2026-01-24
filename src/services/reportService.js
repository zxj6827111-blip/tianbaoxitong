const crypto = require('node:crypto');
const db = require('../db');
const { AppError } = require('../errors');
const { buildFinalValues } = require('./reportValuesService');
const { renderPdf } = require('./reportRenderer');
const { renderExcel } = require('./reportExcelService');

const computeSnapshotHash = (values) => {
  const payload = JSON.stringify(values);
  return crypto.createHash('sha256').update(Buffer.from(payload, 'utf8')).digest('hex');
};

const getNextReportVersionNo = async (draftId, client) => {
  const result = await client.query(
    `SELECT COALESCE(MAX(version_no), 0) AS max_no
     FROM report_version
     WHERE draft_id = $1`,
    [draftId]
  );
  return Number(result.rows[0].max_no) + 1;
};

const createReportVersion = async ({ draftId, templateVersion, draftSnapshotHash, userId }, client) => {
  const versionNo = await getNextReportVersionNo(draftId, client);
  const result = await client.query(
    `INSERT INTO report_version
      (draft_id, version_no, generated_at, template_version, draft_snapshot_hash, is_frozen, created_by)
     VALUES ($1, $2, now(), $3, $4, true, $5)
     RETURNING id`,
    [draftId, versionNo, templateVersion, draftSnapshotHash, userId]
  );
  return result.rows[0].id;
};

const updateReportFiles = async ({ reportVersionId, pdfPath, pdfSha, excelPath, excelSha }, client) => {
  await client.query(
    `UPDATE report_version
     SET pdf_path = $1,
         pdf_sha256 = $2,
         excel_path = $3,
         excel_sha256 = $4,
         updated_at = now()
     WHERE id = $5`,
    [pdfPath, pdfSha, excelPath, excelSha, reportVersionId]
  );
};

const generateReportVersion = async ({ draftId, userId }) => {
  const payload = await buildFinalValues(draftId);
  if (!payload) {
    throw new AppError({
      statusCode: 404,
      code: 'DRAFT_NOT_FOUND',
      message: 'Draft not found'
    });
  }

  const snapshotHash = computeSnapshotHash(payload.values);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const reportVersionId = await createReportVersion({
      draftId,
      templateVersion: payload.draft.template_version,
      draftSnapshotHash: snapshotHash,
      userId
    }, client);

    await client.query('COMMIT');

    const { pdfPath, pdfSha } = await renderPdf({
      templateVersion: payload.draft.template_version,
      values: payload.values,
      reportVersionId
    });

    const { excelPath, excelSha } = await renderExcel({
      values: payload.values,
      reportVersionId,
      draftSnapshotHash: snapshotHash
    });

    await client.query('BEGIN');
    await updateReportFiles({ reportVersionId, pdfPath, pdfSha, excelPath, excelSha }, client);
    await client.query('COMMIT');

    return {
      reportVersionId,
      draftSnapshotHash: snapshotHash,
      pdfPath,
      excelPath
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getReportVersion = async (reportVersionId) => {
  const result = await db.query(
    `SELECT id, draft_id, template_version, draft_snapshot_hash, pdf_path, pdf_sha256,
            excel_path, excel_sha256, is_frozen
     FROM report_version
     WHERE id = $1`,
    [reportVersionId]
  );
  return result.rows[0];
};

module.exports = {
  generateReportVersion,
  getReportVersion,
  computeSnapshotHash
};
