const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../db');
const { AppError } = require('../errors');
const { buildFinalValues } = require('./reportValuesService');
const { renderExcel } = require('./reportExcelService');
const { renderPdfFromExcel } = require('./excelPdfService');
const { validatePdfOutput } = require('./pdfPreflightService');
const { getReportFilePath, reportDir } = require('./reportStorage');

const computeSnapshotHash = (values) => {
  const payload = JSON.stringify(values);
  return crypto.createHash('sha256').update(Buffer.from(payload, 'utf8')).digest('hex');
};

const buildPreviewId = ({ draftId, userId }) => `preview_d${draftId}_u${userId}`;

const getPreviewPdfPath = ({ draftId, userId }) =>
  getLatestPreviewPath({ draftId, userId, extension: 'pdf' });

const getPreviewExcelPath = ({ draftId, userId }) =>
  getLatestPreviewPath({ draftId, userId, extension: 'xlsx' });

const listPreviewArtifacts = ({ draftId, userId, extension }) => {
  const previewId = buildPreviewId({ draftId, userId });
  const prefix = `${previewId}_preview`;
  const suffix = `.${extension}`;
  const fallback = getReportFilePath({ reportVersionId: previewId, suffix: `preview.${extension}` });

  let entries;
  try {
    entries = fsSync.readdirSync(reportDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    return [{
      path: fallback,
      mtimeMs: -1
    }];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix))
    .map((entry) => {
      const filePath = path.join(reportDir, entry.name);
      try {
        const stat = fsSync.statSync(filePath);
        return {
          path: filePath,
          mtimeMs: Number(stat.mtimeMs || 0)
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
};

const getLatestPreviewPath = ({ draftId, userId, extension }) => {
  const artifacts = listPreviewArtifacts({ draftId, userId, extension });
  if (artifacts.length > 0) {
    return artifacts[0].path;
  }
  return getReportFilePath({
    reportVersionId: buildPreviewId({ draftId, userId }),
    suffix: `preview.${extension}`
  });
};

const cleanupOldPreviewArtifacts = async ({ draftId, userId, extension, keep = 4 }) => {
  const artifacts = listPreviewArtifacts({ draftId, userId, extension });
  if (artifacts.length <= keep) {
    return;
  }

  const stale = artifacts.slice(keep);
  await Promise.all(stale.map(async (artifact) => {
    try {
      await fs.unlink(artifact.path);
    } catch {
      // Ignore stale cleanup failures.
    }
  }));
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
  let reportVersionId = null;
  let previewPdfPath = null;
  try {
    await client.query('BEGIN');
    reportVersionId = await createReportVersion({
      draftId,
      templateVersion: payload.draft.template_version,
      draftSnapshotHash: snapshotHash,
      userId
    }, client);

    await client.query('COMMIT');

    const { excelPath, excelSha } = await renderExcel({
      values: payload.values,
      reportVersionId,
      draftSnapshotHash: snapshotHash,
      sourcePath: payload.uploadFilePath,
      year: payload.draft.year,
      caliber: payload.draft.caliber || 'unit'
    });

    const previewPdfSuffix = 'report.preview.pdf';
    const previewPdf = await renderPdfFromExcel({
      excelPath,
      reportVersionId,
      suffix: previewPdfSuffix
    });
    previewPdfPath = previewPdf.pdfPath;
    await validatePdfOutput({ pdfPath: previewPdf.pdfPath });

    const finalPdfPath = getReportFilePath({ reportVersionId, suffix: 'report.pdf' });
    await fs.rename(previewPdf.pdfPath, finalPdfPath);
    previewPdfPath = null;

    await client.query('BEGIN');
    await updateReportFiles({
      reportVersionId,
      pdfPath: finalPdfPath,
      pdfSha: previewPdf.pdfSha,
      excelPath,
      excelSha
    }, client);
    await client.query('COMMIT');

    return {
      reportVersionId,
      draftSnapshotHash: snapshotHash,
      pdfPath: finalPdfPath,
      excelPath
    };
  } catch (error) {
    if (previewPdfPath) {
      try {
        await fs.unlink(previewPdfPath);
      } catch (unlinkError) {
        // Ignore cleanup failures for temp preview files.
      }
    }
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback failures when no active transaction exists.
    }

    // If rendering failed after version creation, clean the half-baked version row.
    if (reportVersionId) {
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM report_version
           WHERE id = $1
             AND (pdf_path IS NULL OR pdf_path = '')
             AND (excel_path IS NULL OR excel_path = '')`,
          [reportVersionId]
        );
        await client.query('COMMIT');
      } catch (cleanupError) {
        try {
          await client.query('ROLLBACK');
        } catch (cleanupRollbackError) {
          // Ignore cleanup rollback errors.
        }
        console.error('Failed to cleanup incomplete report version:', cleanupError);
      }
    }
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

const generateReportPreview = async ({ draftId, userId }) => {
  const payload = await buildFinalValues(draftId);
  if (!payload) {
    throw new AppError({
      statusCode: 404,
      code: 'DRAFT_NOT_FOUND',
      message: 'Draft not found'
    });
  }

  const snapshotHash = computeSnapshotHash(payload.values);
  const previewId = buildPreviewId({ draftId, userId });
  const previewRunId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  let excelPath = null;
  let pdfPath = null;
  try {
    const excelResult = await renderExcel({
      values: payload.values,
      reportVersionId: previewId,
      draftSnapshotHash: snapshotHash,
      sourcePath: payload.uploadFilePath,
      year: payload.draft.year,
      caliber: payload.draft.caliber || 'unit',
      suffix: `preview.${previewRunId}.xlsx`
    });
    excelPath = excelResult.excelPath;

    const previewPdf = await renderPdfFromExcel({
      excelPath,
      reportVersionId: previewId,
      suffix: `preview.${previewRunId}.pdf`
    });
    pdfPath = previewPdf.pdfPath;

    const preflight = await validatePdfOutput({ pdfPath: previewPdf.pdfPath });
    await cleanupOldPreviewArtifacts({ draftId, userId, extension: 'xlsx' });
    await cleanupOldPreviewArtifacts({ draftId, userId, extension: 'pdf' });

    return {
      previewId,
      pdfPath: previewPdf.pdfPath,
      excelPath,
      preflight
    };
  } catch (error) {
    for (const filePath of [pdfPath, excelPath]) {
      if (!filePath) continue;
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        // Ignore preview temp cleanup failures.
      }
    }
    throw error;
  }
};

module.exports = {
  generateReportVersion,
  getReportVersion,
  computeSnapshotHash,
  generateReportPreview,
  getPreviewPdfPath,
  getPreviewExcelPath
};
