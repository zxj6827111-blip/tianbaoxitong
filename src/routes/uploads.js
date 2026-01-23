const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const { AppError } = require('../errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseBudgetWorkbook } = require('../services/excelParser');
const { ensureUploadDir, getUploadFilePath } = require('../services/uploadStorage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', requireAuth, requireRole(['admin', 'maintainer', 'reporter']), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'Excel file is required'
      }));
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext !== '.xlsx') {
      return next(new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only .xlsx files are supported'
      }));
    }

    const unitId = req.user.unit_id;
    const year = Number(req.body.year);
    const caliber = req.body.caliber || 'unit';

    if (!unitId || !Number.isInteger(year)) {
      return next(new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'unit_id and year are required'
      }));
    }

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const insertResult = await db.query(
      `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, file_hash, status`,
      [unitId, year, caliber, req.file.originalname, fileHash, 'UPLOADED', req.user.id]
    );

    const uploadId = insertResult.rows[0].id;

    await ensureUploadDir();
    const filePath = getUploadFilePath(uploadId, req.file.originalname);
    await fs.writeFile(filePath, req.file.buffer);

    return res.status(201).json({
      upload_id: uploadId,
      file_hash: insertResult.rows[0].file_hash,
      status: insertResult.rows[0].status
    });
  } catch (error) {
    if (error.code === '23505') {
      return next(new AppError({
        statusCode: 409,
        code: 'UPLOAD_CONFLICT',
        message: 'Upload already exists for this unit and year'
      }));
    }
    return next(error);
  }
});

router.post('/:id/parse', requireAuth, requireRole(['admin', 'maintainer', 'reporter']), async (req, res, next) => {
  const uploadId = req.params.id;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const uploadResult = await client.query(
      `SELECT id, unit_id, year, file_name
       FROM upload_job
       WHERE id = $1`,
      [uploadId]
    );

    if (uploadResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'UPLOAD_NOT_FOUND',
        message: 'Upload not found'
      });
    }

    const uploadJob = uploadResult.rows[0];

    const existingDraft = await client.query(
      `SELECT id, status
       FROM report_draft
       WHERE upload_id = $1`,
      [uploadId]
    );

    if (existingDraft.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({
        draft_id: existingDraft.rows[0].id,
        upload_id: uploadId,
        extracted_keys_count: 0,
        status: existingDraft.rows[0].status
      });
    }

    const filePath = getUploadFilePath(uploadId, uploadJob.file_name);
    const parseResult = await parseBudgetWorkbook(filePath);

    await client.query('DELETE FROM parsed_cells WHERE upload_id = $1', [uploadId]);
    await client.query('DELETE FROM facts_budget WHERE upload_id = $1', [uploadId]);

    const parsedCells = parseResult.parsedCells;
    const parsedCellRows = [];

    for (const cell of parsedCells) {
      const insertCell = await client.query(
        `INSERT INTO parsed_cells
          (upload_id, sheet_name, cell_address, anchor, raw_value, normalized_value, value_type, number_format)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, sheet_name, cell_address`,
        [
          uploadId,
          cell.sheet_name,
          cell.cell_address,
          cell.anchor,
          cell.raw_value,
          cell.normalized_value,
          cell.value_type,
          cell.number_format
        ]
      );
      parsedCellRows.push(insertCell.rows[0]);
    }

    const parsedCellIndex = new Map(
      parsedCellRows.map((row) => [`${row.sheet_name}::${row.cell_address}`, row])
    );

    for (const fact of parseResult.facts) {
      const evidenceCells = fact.evidence_cells
        .map((cell) => parsedCellIndex.get(`${cell.sheet_name}::${cell.cell_address}`))
        .filter(Boolean)
        .map((cell) => ({
          id: cell.id,
          sheet_name: cell.sheet_name,
          cell_address: cell.cell_address
        }));

      await client.query(
        `INSERT INTO facts_budget
          (upload_id, unit_id, year, key, value_numeric, evidence, provenance)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uploadId,
          uploadJob.unit_id,
          uploadJob.year,
          fact.key,
          fact.value_numeric,
          JSON.stringify({ cells: evidenceCells }),
          'upload_excel'
        ]
      );
    }

    const draftResult = await client.query(
      `INSERT INTO report_draft
        (unit_id, year, template_version, status, created_by, upload_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status`,
      [
        uploadJob.unit_id,
        uploadJob.year,
        'shanghai_v1',
        'DRAFT',
        req.user.id,
        uploadId
      ]
    );

    await client.query(
      `UPDATE upload_job
       SET status = $1, updated_at = now()
       WHERE id = $2`,
      ['PARSED', uploadId]
    );

    await client.query('COMMIT');

    return res.json({
      draft_id: draftResult.rows[0].id,
      upload_id: uploadId,
      extracted_keys_count: parseResult.facts.length,
      status: draftResult.rows[0].status
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof AppError) {
      return next(error);
    }
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
