const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const multer = require('multer');
const { AppError } = require('../errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const db = require('../db');
const { parseHistoryWorkbook } = require('../services/historyExcelParser');
const { HISTORY_ACTUAL_KEYS, HISTORY_ACTUAL_FIELD_DEFS } = require('../services/historyActualsConfig');
const {
  fetchUnitMapByCodes,
  findLockedUnitYears,
  createHistoryBatch,
  updateHistoryBatch,
  insertHistoryActuals,
  lockHistoryBatch,
  listUnitHistoryYears,
  getUnitHistoryByYear
} = require('../repositories/historyRepository');

const router = express.Router();

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip'
]);
const isValidXlsxUpload = (file) => {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (ext !== '.xlsx') return false;
  const mime = String(file?.mimetype || '').toLowerCase();
  return !mime || XLSX_MIME_TYPES.has(mime);
};
const DEFAULT_MAX_IMPORT_MB = 20;
const configuredImportLimitMb = Number(process.env.HISTORY_IMPORT_MAX_MB || process.env.UPLOAD_MAX_MB || DEFAULT_MAX_IMPORT_MB);
const maxImportLimitMb = Number.isFinite(configuredImportLimitMb) && configuredImportLimitMb > 0
  ? configuredImportLimitMb
  : DEFAULT_MAX_IMPORT_MB;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.floor(maxImportLimitMb * 1024 * 1024)
  },
  fileFilter: (req, file, cb) => {
    if (!isValidXlsxUpload(file)) {
      return cb(new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only .xlsx files are supported'
      }));
    }
    return cb(null, true);
  }
});

router.get('/units/:unitId/years', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const years = await listUnitHistoryYears({ unitId: req.params.unitId });
    return res.json({
      unit_id: req.params.unitId,
      years
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/units/:unitId/years/:year', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 1900) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'year must be a valid integer'
      });
    }

    const rows = await getUnitHistoryByYear({ unitId: req.params.unitId, year });
    const valueMap = new Map(rows.map((row) => [row.key, Number(row.value_numeric)]));

    const fields = HISTORY_ACTUAL_FIELD_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      group: def.group,
      value: valueMap.has(def.key) ? valueMap.get(def.key) : null
    }));

    return res.json({
      unit_id: req.params.unitId,
      year,
      fields
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/import', requireAuth, requireRole(['admin']), upload.single('file'), async (req, res, next) => {
  const client = await db.getClient();
  let transactionStarted = false;
  try {
    if (!req.file) {
      throw new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'Excel file is required'
      });
    }

    const ext = (req.file.originalname || '').toLowerCase();
    if (!ext.endsWith('.xlsx')) {
      throw new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only .xlsx files are supported'
      });
    }

    const parseResult = await parseHistoryWorkbook(req.file.buffer, HISTORY_ACTUAL_KEYS);
    const rows = parseResult.rows;
    const errors = [...parseResult.errors];

    const unitCodes = Array.from(new Set(rows.map((row) => row.unit_code)));
    await client.query('BEGIN');
    transactionStarted = true;

    const unitMap = await fetchUnitMapByCodes(client, unitCodes);
    const resolvedRows = [];

    rows.forEach((row) => {
      const unitId = unitMap.get(row.unit_code);
      if (!unitId) {
        errors.push({
          row: row.row_number,
          code: 'UNKNOWN_UNIT',
          message: 'Unit code not found',
          details: { unit_code: row.unit_code }
        });
        return;
      }
      resolvedRows.push({
        ...row,
        unit_id: unitId
      });
    });

    const lockCheckRows = resolvedRows.map((row) => ({
      unit_id: row.unit_id,
      year: row.year
    }));
    const unitIds = lockCheckRows.map((row) => row.unit_id);
    const years = lockCheckRows.map((row) => row.year);

    const locked = await findLockedUnitYears(client, unitIds, years);
    if (locked.length > 0) {
      await client.query('ROLLBACK');
      throw new AppError({
        statusCode: 409,
        code: 'HISTORY_LOCKED',
        message: 'History actuals are locked for the given unit and year',
        details: { locked }
      });
    }

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const batch = await createHistoryBatch(client, {
      source_file_name: req.file.originalname,
      source_file_hash: fileHash,
      status: 'PENDING',
      errors_json: errors.length > 0 ? errors : null
    });

    const insertRows = resolvedRows.map((row) => ({
      unit_id: row.unit_id,
      year: row.year,
      stage: 'FINAL',
      key: row.key,
      value_numeric: row.value_wanyuan,
      source_batch_id: batch.id,
      is_locked: false
    }));

    if (insertRows.length > 0) {
      await insertHistoryActuals(client, insertRows);
    }

    const status = errors.length > 0 ? (insertRows.length > 0 ? 'PARTIAL' : 'FAILED') : 'IMPORTED';
    const updatedBatch = await updateHistoryBatch(client, batch.id, {
      status,
      errors_json: errors.length > 0 ? errors : null
    });

    await client.query('COMMIT');

    if (errors.length > 0) {
      return res.status(422).json({
        batch_id: updatedBatch.id,
        status: updatedBatch.status,
        errors: updatedBatch.errors_json || []
      });
    }

    return res.status(201).json({
      batch_id: updatedBatch.id,
      status: updatedBatch.status,
      imported_count: insertRows.length
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/batch/:batchId/lock', requireAuth, requireRole(['admin']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await lockHistoryBatch(client, req.params.batchId, req.user.id);
    if (result.status === 'not_found') {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'History batch not found'
      });
    }
    if (result.status === 'already_locked') {
      throw new AppError({
        statusCode: 409,
        code: 'ALREADY_LOCKED',
        message: 'History batch already locked'
      });
    }
    await client.query('COMMIT');
    return res.json({
      batch_id: req.params.batchId,
      locked_at: result.locked_at
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
