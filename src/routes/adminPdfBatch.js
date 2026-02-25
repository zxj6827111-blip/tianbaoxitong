const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const multer = require('multer');
const db = require('../db');
const { AppError } = require('../errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ensureUploadDir, getUploadFilePath } = require('../services/uploadStorage');
const {
  extractPdfText,
  identifyUnitAndYear,
  matchExistingUnit,
  loadUnitCatalog,
  normalizeUploadedFilename
} = require('../services/pdfBatchService');
const { upsertArchiveFromPdf } = require('../services/archivePdfIngestService');

const router = express.Router();

const PDF_MIME_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/octet-stream'
]);
const DEFAULT_MAX_FILE_MB = 20;
const DEFAULT_MAX_FILES = 50;
const DEFAULT_PENDING_TTL_MS = 30 * 60 * 1000;
const maxFileMb = Number(process.env.PDF_BATCH_MAX_MB || process.env.UPLOAD_MAX_MB || DEFAULT_MAX_FILE_MB);
const maxFileBytes = Math.max(1, Math.floor((Number.isFinite(maxFileMb) ? maxFileMb : DEFAULT_MAX_FILE_MB) * 1024 * 1024));
const maxFiles = Math.max(1, Number(process.env.PDF_BATCH_MAX_FILES || DEFAULT_MAX_FILES));
const pendingTtlMs = Math.max(60 * 1000, Number(process.env.PDF_BATCH_PENDING_TTL_MS || DEFAULT_PENDING_TTL_MS));

const stagingRootDir = path.resolve(process.cwd(), 'storage', 'pdf-batch-staging');
const pendingBatches = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxFileBytes,
    files: maxFiles
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file?.originalname || '').toLowerCase();
    const mime = String(file?.mimetype || '').toLowerCase();
    if (ext !== '.pdf' || (mime && !PDF_MIME_TYPES.has(mime))) {
      return cb(new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only PDF files are supported'
      }));
    }
    return cb(null, true);
  }
});

const sanitizeFilename = (name) => {
  const base = path.basename(String(name || 'file.pdf')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return base || 'file.pdf';
};

const normalizeYear = (value) => {
  const year = Number(value);
  if (!Number.isInteger(year)) return null;
  if (year < 1900 || year > 2100) return null;
  return year;
};

const inferReportTypeFromFilename = (fileName) => (/决算|final/i.test(String(fileName || '')) ? 'FINAL' : 'BUDGET');
const BATCH_DETECTED_SCOPE = {
  DEPARTMENT: 'DEPARTMENT',
  UNIT: 'UNIT'
};
const normalizeDetectedScope = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === BATCH_DETECTED_SCOPE.DEPARTMENT) return BATCH_DETECTED_SCOPE.DEPARTMENT;
  if (normalized === BATCH_DETECTED_SCOPE.UNIT) return BATCH_DETECTED_SCOPE.UNIT;
  return null;
};

const ensureStagingRoot = async () => {
  await fs.mkdir(stagingRootDir, { recursive: true });
};

const removePendingBatch = async (batchToken) => {
  const existing = pendingBatches.get(batchToken);
  if (!existing) return;
  pendingBatches.delete(batchToken);
  if (existing.dir_path) {
    await fs.rm(existing.dir_path, { recursive: true, force: true });
  }
};

const cleanupExpiredPendingBatches = async () => {
  const now = Date.now();
  const expired = [];
  for (const [token, value] of pendingBatches.entries()) {
    if (now - value.created_at > pendingTtlMs) {
      expired.push(token);
    }
  }
  for (const token of expired) {
    await removePendingBatch(token);
  }
};

router.post('/upload', requireAuth, requireRole(['admin', 'maintainer']), upload.array('files', maxFiles), async (req, res, next) => {
  try {
    await cleanupExpiredPendingBatches();
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      throw new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'At least one PDF file is required'
      });
    }

    await ensureStagingRoot();
    const unitCatalog = await loadUnitCatalog();
    const batchToken = crypto.randomUUID();
    const batchDir = path.join(stagingRootDir, batchToken);
    await fs.mkdir(batchDir, { recursive: true });

    const internalItems = [];
    const responseItems = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const decodedOriginalName = normalizeUploadedFilename(file.originalname);
      const safeName = sanitizeFilename(decodedOriginalName || file.originalname);
      const tempId = crypto.randomUUID();
      const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const stagedName = `${String(index + 1).padStart(3, '0')}__${safeName}`;
      const stagedPath = path.join(batchDir, stagedName);
      await fs.writeFile(stagedPath, file.buffer);

      let detected = { unitName: null, year: null, unitSource: null, yearSource: null };
      let parseError = null;
      try {
        const text = await extractPdfText(file.buffer);
        detected = identifyUnitAndYear(safeName, text);
      } catch (error) {
        parseError = error?.message || 'PDF text parse failed';
      }

      const matched = detected.unitName
        ? matchExistingUnit(detected.unitName, unitCatalog, { scope: detected.scope || null })
        : null;
      internalItems.push({
        temp_id: tempId,
        file_name: safeName,
        staged_path: stagedPath,
        file_hash: fileHash,
        size: Number(file.size || 0),
        detected_unit_name: detected.unitName || null,
        detected_year: detected.year || null,
        detected_scope: detected.scope || null,
        matched_unit_id: matched?.unit?.id || null
      });

      responseItems.push({
        temp_id: tempId,
        file_name: safeName,
        size: Number(file.size || 0),
        detected_unit_name: detected.unitName || null,
        detected_year: detected.year || null,
        detected_scope: detected.scope || null,
        unit_source: detected.unitSource || null,
        year_source: detected.yearSource || null,
        match_status: matched ? matched.match_type : 'none',
        confidence: matched ? matched.confidence : 0,
        matched_unit: matched ? {
          id: matched.unit.id,
          name: matched.unit.name,
          code: matched.unit.code,
          department_id: matched.unit.department_id,
          department_name: matched.unit.department_name
        } : null,
        warning: parseError
      });
    }

    pendingBatches.set(batchToken, {
      created_at: Date.now(),
      dir_path: batchDir,
      files: internalItems
    });

    return res.json({
      batch_token: batchToken,
      items: responseItems,
      unit_options: unitCatalog
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/process', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const batchToken = String(req.body?.batch_token || '').trim();
  const payloadItems = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!batchToken) {
    return next(new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'batch_token is required'
    }));
  }

  await cleanupExpiredPendingBatches();
  const pending = pendingBatches.get(batchToken);
  if (!pending) {
    return next(new AppError({
      statusCode: 404,
      code: 'BATCH_NOT_FOUND',
      message: 'Batch token not found or expired'
    }));
  }

  const overrideByTempId = new Map();
  payloadItems.forEach((item) => {
    const tempId = String(item?.temp_id || '').trim();
    if (!tempId) return;
    overrideByTempId.set(tempId, item);
  });

  const unitCatalog = await loadUnitCatalog();
  const unitById = new Map(unitCatalog.map((unit) => [String(unit.id), unit]));
  const departmentById = new Map();
  unitCatalog.forEach((unit) => {
    const departmentId = String(unit.department_id || '').trim();
    if (!departmentId || departmentById.has(departmentId)) return;
    departmentById.set(departmentId, {
      id: departmentId,
      name: unit.department_name || null
    });
  });

  const writeProgress = (payload) => {
    res.write(`${JSON.stringify(payload)}\n`);
  };

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  writeProgress({ type: 'start', total: pending.files.length });

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const committedArchiveKeys = new Set();

  try {
    await ensureUploadDir();

    for (let index = 0; index < pending.files.length; index += 1) {
      const pendingItem = pending.files[index];
      const override = overrideByTempId.get(pendingItem.temp_id) || {};
      const shouldSkip = override.skip === true;
      const reportType = inferReportTypeFromFilename(pendingItem.file_name);
      const overrideScope = normalizeDetectedScope(override.scope);
      const detectedScope = normalizeDetectedScope(pendingItem.detected_scope);
      const scope = (
        overrideScope
        || detectedScope
        || (override.unit_id ? BATCH_DETECTED_SCOPE.UNIT : null)
        || ((!override.unit_id && override.department_id) ? BATCH_DETECTED_SCOPE.DEPARTMENT : null)
        || BATCH_DETECTED_SCOPE.UNIT
      );
      const overrideUnitId = String(override.unit_id || '').trim();
      const fallbackMatchedUnitId = String(pendingItem.matched_unit_id || '').trim();
      const unitId = overrideUnitId || fallbackMatchedUnitId;
      const overrideDepartmentId = String(override.department_id || '').trim();
      const year = normalizeYear(override.year ?? pendingItem.detected_year);
      if (shouldSkip) {
        skippedCount += 1;
        writeProgress({
          type: 'item',
          index: index + 1,
          total: pending.files.length,
          temp_id: pendingItem.temp_id,
          status: 'skipped',
          reason: 'manually_skipped'
        });
        continue;
      }

      if (!year) {
        failedCount += 1;
        writeProgress({
          type: 'item',
          index: index + 1,
          total: pending.files.length,
          temp_id: pendingItem.temp_id,
          status: 'failed',
          reason: 'year is missing or invalid'
        });
        continue;
      }

      let resolvedDepartmentId = overrideDepartmentId;
      let resolvedUnitId = unitId;
      if (scope === BATCH_DETECTED_SCOPE.DEPARTMENT) {
        if (!resolvedDepartmentId && resolvedUnitId && unitById.has(resolvedUnitId)) {
          resolvedDepartmentId = String(unitById.get(resolvedUnitId)?.department_id || '').trim();
        }
        if (!resolvedDepartmentId || !departmentById.has(resolvedDepartmentId)) {
          failedCount += 1;
          writeProgress({
            type: 'item',
            index: index + 1,
            total: pending.files.length,
            temp_id: pendingItem.temp_id,
            status: 'failed',
            reason: 'department_id is missing or invalid'
          });
          continue;
        }
        resolvedUnitId = '';
      } else {
        if (!resolvedUnitId || !unitById.has(resolvedUnitId)) {
          failedCount += 1;
          writeProgress({
            type: 'item',
            index: index + 1,
            total: pending.files.length,
            temp_id: pendingItem.temp_id,
            status: 'failed',
            reason: 'unit_id is missing or invalid'
          });
          continue;
        }
        const mappedDepartmentId = String(unitById.get(resolvedUnitId)?.department_id || '').trim();
        if (!mappedDepartmentId) {
          failedCount += 1;
          writeProgress({
            type: 'item',
            index: index + 1,
            total: pending.files.length,
            temp_id: pendingItem.temp_id,
            status: 'failed',
            reason: 'unit has no department mapping'
          });
          continue;
        }
        if (resolvedDepartmentId && resolvedDepartmentId !== mappedDepartmentId) {
          failedCount += 1;
          writeProgress({
            type: 'item',
            index: index + 1,
            total: pending.files.length,
            temp_id: pendingItem.temp_id,
            status: 'failed',
            reason: 'unit_id does not belong to department_id'
          });
          continue;
        }
        resolvedDepartmentId = mappedDepartmentId;
      }

      const archiveKey = scope === BATCH_DETECTED_SCOPE.DEPARTMENT
        ? `department:${resolvedDepartmentId}:${year}:${reportType}`
        : `unit:${resolvedUnitId}:${year}:${reportType}`;
      if (committedArchiveKeys.has(archiveKey)) {
        failedCount += 1;
        writeProgress({
          type: 'item',
          index: index + 1,
          total: pending.files.length,
          temp_id: pendingItem.temp_id,
          status: 'failed',
          reason: scope === BATCH_DETECTED_SCOPE.DEPARTMENT
            ? 'duplicate_department_year_report_type_in_batch'
            : 'duplicate_unit_year_report_type_in_batch'
        });
        continue;
      }

      const client = await db.getClient();
      let finalPath = null;
      let archiveFilePath = null;
      try {
        await client.query('BEGIN');

        if (scope === BATCH_DETECTED_SCOPE.DEPARTMENT) {
          const archiveSync = await upsertArchiveFromPdf({
            client,
            scope: 'department',
            departmentId: resolvedDepartmentId,
            year,
            fileName: pendingItem.file_name,
            fileHash: pendingItem.file_hash,
            fileSize: pendingItem.size,
            sourceFilePath: pendingItem.staged_path,
            uploadedBy: req.user.id || null,
            reportType
          });
          archiveFilePath = archiveSync.archive_file_path || null;

          await client.query(
            `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json, ip, user_agent)
             VALUES ($1, 'PDF_BATCH_UPLOAD_IMPORTED', 'org_dept_annual_report', $2, $3, $4, $5)`,
            [
              req.user.id || null,
              archiveSync.report_id,
              JSON.stringify({
                scope: 'department',
                file_name: pendingItem.file_name,
                file_size: pendingItem.size,
                department_id: resolvedDepartmentId,
                year,
                archive_report_id: archiveSync.report_id,
                archive_report_type: archiveSync.report_type,
                archive_extracted_text_length: archiveSync.extracted_text_length
              }),
              req.ip || null,
              req.headers['user-agent'] || null
            ]
          );

          await client.query('COMMIT');
          committedArchiveKeys.add(archiveKey);
          successCount += 1;
          writeProgress({
            type: 'item',
            index: index + 1,
            total: pending.files.length,
            temp_id: pendingItem.temp_id,
            status: 'success',
            scope: 'department',
            department_id: resolvedDepartmentId,
            year,
            archive_synced: true
          });
          continue;
        }

        const insertResult = await client.query(
          `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status, uploaded_by)
           VALUES ($1, $2, 'pdf', $3, $4, 'PDF_UPLOADED', $5)
           ON CONFLICT (unit_id, year, file_hash)
           DO UPDATE
             SET file_name = EXCLUDED.file_name,
                 uploaded_by = EXCLUDED.uploaded_by,
                 updated_at = NOW()
           RETURNING id`,
          [resolvedUnitId, year, pendingItem.file_name, pendingItem.file_hash, req.user.id]
        );

        const uploadId = String(insertResult.rows[0].id);
        finalPath = getUploadFilePath(uploadId, pendingItem.file_name);
        await fs.copyFile(pendingItem.staged_path, finalPath);

        const archiveSync = await upsertArchiveFromPdf({
          client,
          scope: 'unit',
          departmentId: resolvedDepartmentId,
          unitId: resolvedUnitId,
          year,
          fileName: pendingItem.file_name,
          fileHash: pendingItem.file_hash,
          fileSize: pendingItem.size,
          sourceFilePath: finalPath,
          uploadedBy: req.user.id || null,
          reportType
        });
        archiveFilePath = archiveSync.archive_file_path || null;

        await client.query(
          `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json, ip, user_agent)
           VALUES ($1, 'PDF_BATCH_UPLOAD_IMPORTED', 'upload_job', $2, $3, $4, $5)`,
          [
            req.user.id || null,
            uploadId,
            JSON.stringify({
              scope: 'unit',
              file_name: pendingItem.file_name,
              file_size: pendingItem.size,
              department_id: resolvedDepartmentId,
              unit_id: resolvedUnitId,
              year,
              archive_report_id: archiveSync.report_id,
              archive_department_id: archiveSync.department_id,
              archive_report_type: archiveSync.report_type,
              archive_extracted_text_length: archiveSync.extracted_text_length
            }),
            req.ip || null,
            req.headers['user-agent'] || null
          ]
        );

        await client.query('COMMIT');
        committedArchiveKeys.add(archiveKey);
        successCount += 1;
        writeProgress({
          type: 'item',
          index: index + 1,
          total: pending.files.length,
          temp_id: pendingItem.temp_id,
          status: 'success',
          scope: 'unit',
          upload_id: uploadId,
          unit_id: resolvedUnitId,
          year,
          archive_synced: true
        });
      } catch (error) {
        const cleanupArchiveFilePath = archiveFilePath || error?.archiveFilePath || null;
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore nested rollback errors.
        }
        if (finalPath) {
          try {
            await fs.unlink(finalPath);
          } catch {
            // Ignore cleanup failure.
          }
        }
        if (cleanupArchiveFilePath) {
          try {
            await fs.unlink(cleanupArchiveFilePath);
          } catch {
            // Ignore cleanup failure.
          }
        }
        failedCount += 1;
        writeProgress({
          type: 'item',
          index: index + 1,
          total: pending.files.length,
          temp_id: pendingItem.temp_id,
          status: 'failed',
          reason: error?.message || 'Unexpected error'
        });
      } finally {
        client.release();
      }
    }

    writeProgress({
      type: 'summary',
      total: pending.files.length,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount
    });
    res.end();
  } catch (error) {
    writeProgress({
      type: 'summary',
      total: pending.files.length,
      success: successCount,
      failed: failedCount + 1,
      skipped: skippedCount,
      error: error?.message || 'Unexpected error'
    });
    res.end();
  } finally {
    await removePendingBatch(batchToken);
  }
});

module.exports = router;
