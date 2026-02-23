const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../db');
const { AppError } = require('../errors');
const logger = require('./logger');
const { buildFinalValues } = require('./reportValuesService');
const { renderExcel } = require('./reportExcelService');
const { renderPdfFromExcel } = require('./excelPdfService');
const { validatePdfOutput } = require('./pdfPreflightService');
const { getReportFilePath, reportDir } = require('./reportStorage');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const REPORT_GEN_MAX_CONCURRENCY = parsePositiveInt(process.env.REPORT_GENERATION_CONCURRENCY, 2);
const REPORT_GEN_WAIT_TIMEOUT_MS = parsePositiveInt(process.env.REPORT_GENERATION_QUEUE_TIMEOUT_MS, 180000);
const REPORT_GEN_WAIT_POLL_MS = parsePositiveInt(process.env.REPORT_GENERATION_QUEUE_POLL_MS, 200);
const REPORT_GEN_LOCK_NAMESPACE = 62001;
const REPORT_GEN_METRICS_SAMPLE_LIMIT = parsePositiveInt(process.env.REPORT_GENERATION_METRICS_SAMPLE_LIMIT, 500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generationMetrics = {
  totals: {
    jobs: 0,
    success: 0,
    failed: 0,
    timeout: 0
  },
  queue: {
    waiting_now: 0,
    waiting_peak: 0,
    running_now: 0,
    running_peak: 0,
    wait_ms_samples: []
  },
  duration_ms_samples: [],
  by_operation: {},
  last_error: null
};

const ensureOperationMetric = (operation) => {
  const op = String(operation || 'unknown');
  if (!generationMetrics.by_operation[op]) {
    generationMetrics.by_operation[op] = {
      enqueued: 0,
      jobs: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      wait_ms_samples: [],
      duration_ms_samples: []
    };
  }
  return generationMetrics.by_operation[op];
};

const pushMetricSample = (arr, value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return;
  arr.push(parsed);
  if (arr.length > REPORT_GEN_METRICS_SAMPLE_LIMIT) {
    arr.shift();
  }
};

const averageMetric = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const sum = arr.reduce((acc, item) => acc + Number(item || 0), 0);
  return Number((sum / arr.length).toFixed(2));
};

const markLastError = (operation, error) => {
  generationMetrics.last_error = {
    at: new Date().toISOString(),
    operation: String(operation || 'unknown'),
    code: error?.code || error?.name || 'UNKNOWN_ERROR',
    message: String(error?.message || 'Unknown error')
  };
};

const recordQueueEnqueue = (operation) => {
  const opMetric = ensureOperationMetric(operation);
  opMetric.enqueued += 1;

  generationMetrics.queue.waiting_now += 1;
  if (generationMetrics.queue.waiting_now > generationMetrics.queue.waiting_peak) {
    generationMetrics.queue.waiting_peak = generationMetrics.queue.waiting_now;
  }
};

const recordQueueDequeueToRun = (operation, waitMs) => {
  const opMetric = ensureOperationMetric(operation);

  generationMetrics.queue.waiting_now = Math.max(0, generationMetrics.queue.waiting_now - 1);
  generationMetrics.queue.running_now += 1;
  if (generationMetrics.queue.running_now > generationMetrics.queue.running_peak) {
    generationMetrics.queue.running_peak = generationMetrics.queue.running_now;
  }

  generationMetrics.totals.jobs += 1;
  opMetric.jobs += 1;

  pushMetricSample(generationMetrics.queue.wait_ms_samples, waitMs);
  pushMetricSample(opMetric.wait_ms_samples, waitMs);
};

const recordQueueTimeout = (operation, waitMs, error) => {
  const opMetric = ensureOperationMetric(operation);

  generationMetrics.queue.waiting_now = Math.max(0, generationMetrics.queue.waiting_now - 1);
  generationMetrics.totals.jobs += 1;
  generationMetrics.totals.failed += 1;
  generationMetrics.totals.timeout += 1;

  opMetric.jobs += 1;
  opMetric.failed += 1;
  opMetric.timeout += 1;

  pushMetricSample(generationMetrics.queue.wait_ms_samples, waitMs);
  pushMetricSample(opMetric.wait_ms_samples, waitMs);
  markLastError(operation, error);
};

const recordQueueAbort = (operation, waitMs, error) => {
  const opMetric = ensureOperationMetric(operation);

  generationMetrics.queue.waiting_now = Math.max(0, generationMetrics.queue.waiting_now - 1);
  generationMetrics.totals.jobs += 1;
  generationMetrics.totals.failed += 1;
  opMetric.jobs += 1;
  opMetric.failed += 1;

  pushMetricSample(generationMetrics.queue.wait_ms_samples, waitMs);
  pushMetricSample(opMetric.wait_ms_samples, waitMs);
  markLastError(operation, error);
};

const recordRunSuccess = (operation, durationMs) => {
  const opMetric = ensureOperationMetric(operation);

  generationMetrics.queue.running_now = Math.max(0, generationMetrics.queue.running_now - 1);
  generationMetrics.totals.success += 1;
  opMetric.success += 1;

  pushMetricSample(generationMetrics.duration_ms_samples, durationMs);
  pushMetricSample(opMetric.duration_ms_samples, durationMs);
};

const recordRunFailure = (operation, durationMs, error) => {
  const opMetric = ensureOperationMetric(operation);

  generationMetrics.queue.running_now = Math.max(0, generationMetrics.queue.running_now - 1);
  generationMetrics.totals.failed += 1;
  opMetric.failed += 1;

  pushMetricSample(generationMetrics.duration_ms_samples, durationMs);
  pushMetricSample(opMetric.duration_ms_samples, durationMs);
  markLastError(operation, error);
};

const computeSnapshotHash = (values) => {
  const payload = JSON.stringify(values);
  return crypto.createHash('sha256').update(Buffer.from(payload, 'utf8')).digest('hex');
};

const buildPreviewId = ({ draftId, userId }) => `preview_d${draftId}_u${userId}`;

const getPreviewPdfPath = ({ draftId, userId }) =>
  getLatestPreviewPath({ draftId, userId, extension: 'pdf' });

const getPreviewExcelPath = ({ draftId, userId }) =>
  getLatestPreviewPath({ draftId, userId, extension: 'xlsx' });

const tryAcquireGenerationSlot = async () => {
  const client = await db.getClient();
  try {
    for (let slot = 1; slot <= REPORT_GEN_MAX_CONCURRENCY; slot += 1) {
      const result = await client.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [REPORT_GEN_LOCK_NAMESPACE, slot]
      );
      if (result.rows[0]?.locked) {
        return { client, slot };
      }
    }
  } catch (error) {
    client.release();
    throw error;
  }

  client.release();
  return null;
};

const releaseGenerationSlot = async (lock) => {
  if (!lock || !lock.client) return;

  try {
    await lock.client.query(
      'SELECT pg_advisory_unlock($1, $2)',
      [REPORT_GEN_LOCK_NAMESPACE, lock.slot]
    );
  } catch {
    // Ignore advisory unlock failure and still release connection.
  } finally {
    lock.client.release();
  }
};

const withGenerationSlot = async (taskFn, options = {}) => {
  const operation = String(options.operation || 'unknown');
  const queuedAt = Date.now();
  const deadline = queuedAt + REPORT_GEN_WAIT_TIMEOUT_MS;
  let movedToRunning = false;

  recordQueueEnqueue(operation);

  try {
    while (Date.now() < deadline) {
      const lock = await tryAcquireGenerationSlot();
      if (lock) {
        const waitMs = Date.now() - queuedAt;
        recordQueueDequeueToRun(operation, waitMs);
        movedToRunning = true;

        const runStartedAt = Date.now();
        try {
          const result = await taskFn();
          recordRunSuccess(operation, Date.now() - runStartedAt);
          return result;
        } catch (error) {
          recordRunFailure(operation, Date.now() - runStartedAt, error);
          throw error;
        } finally {
          await releaseGenerationSlot(lock);
        }
      }

      await sleep(REPORT_GEN_WAIT_POLL_MS);
    }

    const timeoutError = new AppError({
      statusCode: 429,
      code: 'REPORT_GENERATION_BUSY',
      message: 'Report generation queue is busy. Please retry shortly.'
    });
    recordQueueTimeout(operation, Date.now() - queuedAt, timeoutError);
    throw timeoutError;
  } catch (error) {
    if (!movedToRunning && error?.code !== 'REPORT_GENERATION_BUSY') {
      recordQueueAbort(operation, Date.now() - queuedAt, error);
    }
    throw error;
  }
};

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
  let attempt = 0;
  const versionConstraintNames = new Set([
    'report_version_uniq_draft_id_version_no',
    'report_version_draft_id_version_no_key'
  ]);
  while (attempt < 5) {
    const versionNo = await getNextReportVersionNo(draftId, client);
    try {
      const result = await client.query(
        `INSERT INTO report_version
          (draft_id, version_no, generated_at, template_version, draft_snapshot_hash, is_frozen, created_by)
         VALUES ($1, $2, now(), $3, $4, true, $5)
         RETURNING id`,
        [draftId, versionNo, templateVersion, draftSnapshotHash, userId]
      );
      return result.rows[0].id;
    } catch (error) {
      const detail = String(error?.detail || '');
      const isVersionConflict = error?.code === '23505'
        && (versionConstraintNames.has(String(error?.constraint || ''))
          || detail.includes('(draft_id, version_no)'));
      if (isVersionConflict) {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
  throw new AppError({
    statusCode: 409,
    code: 'CONCURRENCY_ERROR',
    message: 'Failed to generate report version due to high concurrency. Please try again later.'
  });
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

    const { excelPath, excelSha, previewPdf } = await withGenerationSlot(async () => {
      const excelRes = await renderExcel({
        values: payload.values,
        reportVersionId,
        draftSnapshotHash: snapshotHash,
        sourcePath: payload.uploadFilePath,
        year: payload.draft.year,
        caliber: payload.draft.caliber || 'unit'
      });

      const previewPdfSuffix = 'report.preview.pdf';
      const pdfRes = await renderPdfFromExcel({
        excelPath: excelRes.excelPath,
        reportVersionId,
        suffix: previewPdfSuffix
      });
      return { ...excelRes, previewPdf: pdfRes };
    }, { operation: 'generate' });

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
        logger.error('report_version_cleanup_failed', { error: cleanupError, reportVersionId });
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
    const previewRes = await withGenerationSlot(async () => {
      const excelResult = await renderExcel({
        values: payload.values,
        reportVersionId: previewId,
        draftSnapshotHash: snapshotHash,
        sourcePath: payload.uploadFilePath,
        year: payload.draft.year,
        caliber: payload.draft.caliber || 'unit',
        suffix: `preview.${previewRunId}.xlsx`
      });

      const previewPdf = await renderPdfFromExcel({
        excelPath: excelResult.excelPath,
        reportVersionId: previewId,
        suffix: `preview.${previewRunId}.pdf`
      });

      return { excelResult, previewPdf };
    }, { operation: 'preview' });

    excelPath = previewRes.excelResult.excelPath;
    const previewPdf = previewRes.previewPdf;
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

const getGlobalRunningLockCount = async () => {
  try {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM pg_locks
       WHERE locktype = 'advisory'
         AND classid = $1
         AND objid BETWEEN 1 AND $2
         AND granted = true`,
      [REPORT_GEN_LOCK_NAMESPACE, REPORT_GEN_MAX_CONCURRENCY]
    );
    return Number(result.rows[0]?.count || 0);
  } catch (error) {
    logger.warn('report_generation_metrics_pg_locks_query_failed', { error });
    return null;
  }
};

const toFailureRate = (failed, total) => {
  if (!total) return 0;
  return Number((failed / total).toFixed(4));
};

const getReportGenerationMetrics = async () => {
  const globalRunning = await getGlobalRunningLockCount();

  const byOperation = Object.fromEntries(
    Object.entries(generationMetrics.by_operation).map(([operation, metric]) => ([
      operation,
      {
        enqueued: metric.enqueued,
        jobs: metric.jobs,
        success: metric.success,
        failed: metric.failed,
        timeout: metric.timeout,
        failure_rate: toFailureRate(metric.failed, metric.jobs),
        avg_wait_ms: averageMetric(metric.wait_ms_samples),
        avg_duration_ms: averageMetric(metric.duration_ms_samples)
      }
    ]))
  );

  return {
    config: {
      concurrency_limit: REPORT_GEN_MAX_CONCURRENCY,
      queue_timeout_ms: REPORT_GEN_WAIT_TIMEOUT_MS,
      queue_poll_ms: REPORT_GEN_WAIT_POLL_MS
    },
    queue: {
      waiting_now_local: generationMetrics.queue.waiting_now,
      waiting_peak_local: generationMetrics.queue.waiting_peak,
      running_now_local: generationMetrics.queue.running_now,
      running_peak_local: generationMetrics.queue.running_peak,
      running_now_global: globalRunning
    },
    totals: {
      jobs: generationMetrics.totals.jobs,
      success: generationMetrics.totals.success,
      failed: generationMetrics.totals.failed,
      timeout: generationMetrics.totals.timeout,
      failure_rate: toFailureRate(generationMetrics.totals.failed, generationMetrics.totals.jobs),
      avg_wait_ms: averageMetric(generationMetrics.queue.wait_ms_samples),
      avg_duration_ms: averageMetric(generationMetrics.duration_ms_samples)
    },
    by_operation: byOperation,
    last_error: generationMetrics.last_error
  };
};

module.exports = {
  generateReportVersion,
  getReportVersion,
  computeSnapshotHash,
  generateReportPreview,
  getPreviewPdfPath,
  getPreviewExcelPath,
  getReportGenerationMetrics
};
