const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const { AppError } = require('../errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseBudgetWorkbook } = require('../services/excelParser');
const { BUDGET_MAPPING, BUDGET_MAPPING_DEPARTMENT } = require('../services/budgetMapping');
const { ensureUploadDir, getUploadFilePath } = require('../services/uploadStorage');
const { sanitizeManualTextByKey } = require('../services/manualTextSanitizer');

const router = express.Router();
const DEFAULT_MAX_UPLOAD_MB = 20;
const configuredUploadLimitMb = Number(process.env.UPLOAD_MAX_MB || DEFAULT_MAX_UPLOAD_MB);
const maxUploadLimitMb = Number.isFinite(configuredUploadLimitMb) && configuredUploadLimitMb > 0
  ? configuredUploadLimitMb
  : DEFAULT_MAX_UPLOAD_MB;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.floor(maxUploadLimitMb * 1024 * 1024)
  }
});

const isAdminLike = (user) => {
  const roles = user?.roles || [];
  return roles.includes('admin') || roles.includes('maintainer');
};

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

    // Admin/maintainer can specify unit_id in request body, regular users use their assigned unit
    const adminLike = isAdminLike(req.user);
    const unitId = adminLike && req.body.unit_id ? req.body.unit_id : req.user.unit_id;
    const year = Number(req.body.year);
    const caliber = req.body.caliber || 'unit';

    if (!unitId) {
      return next(new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: adminLike ? 'unit_id is required (please select a unit)' : 'User has no assigned unit'
      }));
    }

    if (!Number.isInteger(year)) {
      return next(new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'year is required'
      }));
    }

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    // Check for existing upload and delete it (Overwrite strategy)
    // This allows users to re-upload if parsing failed or they want to start over
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Find existing upload
      const existing = await client.query(
        'SELECT id FROM upload_job WHERE unit_id = $1 AND year = $2',
        [unitId, year]
      );

      if (existing.rowCount > 0) {
        const oldId = existing.rows[0].id;
        // Delete related drafts first (if any)
        await client.query('DELETE FROM report_draft WHERE upload_id = $1', [oldId]);
        // Delete parsed data
        await client.query('DELETE FROM parsed_cells WHERE upload_id = $1', [oldId]);
        await client.query('DELETE FROM facts_budget WHERE upload_id = $1', [oldId]);
        // Delete the upload job itself
        await client.query('DELETE FROM upload_job WHERE id = $1', [oldId]);
      }

      const insertResult = await client.query(
        `INSERT INTO upload_job (unit_id, year, caliber, file_name, file_hash, status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, file_hash, status`,
        [unitId, year, caliber, req.file.originalname, fileHash, 'UPLOADED', req.user.id]
      );

      await client.query('COMMIT');

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
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/parse', requireAuth, requireRole(['admin', 'maintainer', 'reporter']), async (req, res, next) => {
  const uploadId = req.params.id;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const uploadResult = await client.query(
      `SELECT id, unit_id, year, file_name, caliber, uploaded_by
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
    const hasUploadAccess = isAdminLike(req.user)
      || (req.user?.unit_id && String(req.user.unit_id) === String(uploadJob.unit_id))
      || (uploadJob.uploaded_by && String(uploadJob.uploaded_by) === String(req.user.id));

    if (!hasUploadAccess) {
      throw new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'No permission to parse this upload'
      });
    }

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
    const mapping = uploadJob.caliber === 'department'
      ? BUDGET_MAPPING_DEPARTMENT
      : BUDGET_MAPPING;
    const parseResult = await parseBudgetWorkbook(filePath, mapping);

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

    const draftId = draftResult.rows[0].id;

    // === Save Extracted Texts to Manual Inputs ===
    if (parseResult.texts && parseResult.texts.length > 0) {
      for (const textItem of parseResult.texts) {
        const normalizedText = sanitizeManualTextByKey(textItem.key, textItem.value_text);
        // Upsert manual inputs
        await client.query(
          `INSERT INTO manual_inputs (draft_id, key, value_text, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (draft_id, key) 
           DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = now()`,
          [draftId, textItem.key, normalizedText || null, req.user.id]
        );
      }
    }

    // === Reuse previous-year PDF text content when current year is empty ===
    const historyTextKeys = {
      main_functions: 'FUNCTION',
      organizational_structure: 'STRUCTURE',
      glossary: 'TERMINOLOGY'
    };

    const unitResult = await client.query(
      `SELECT department_id
       FROM org_unit
       WHERE id = $1`,
      [uploadJob.unit_id]
    );

    const departmentId = unitResult.rows[0]?.department_id || null;
    const prevYear = uploadJob.year - 1;

    if (departmentId && Number.isInteger(prevYear) && prevYear > 0) {
      for (const [key, category] of Object.entries(historyTextKeys)) {
        const historyResult = await client.query(
          `SELECT content_text
           FROM org_dept_text_content
           WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET' AND category = $3`,
          [departmentId, prevYear, category]
        );
        const historyText = historyResult.rows[0]?.content_text;
        const normalizedHistoryText = sanitizeManualTextByKey(key, historyText);
        if (!normalizedHistoryText) continue;

        await client.query(
          `INSERT INTO manual_inputs (draft_id, key, value_text, evidence, updated_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (draft_id, key)
           DO UPDATE SET
             value_text = EXCLUDED.value_text,
             evidence = EXCLUDED.evidence,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
           WHERE manual_inputs.value_text IS NULL
              OR manual_inputs.value_text = ''`,
          [
            draftId,
            key,
            normalizedHistoryText,
            JSON.stringify({ source: 'archive_pdf', year: prevYear, category }),
            req.user.id
          ]
        );
      }
    }

    await client.query(
      `UPDATE upload_job
       SET status = $1, updated_at = now()
       WHERE id = $2`,
      ['PARSED', uploadId]
    );

    await client.query('COMMIT');

    return res.json({
      draft_id: draftId,
      upload_id: uploadId,
      extracted_keys_count: parseResult.facts.length,
      extracted_texts_count: parseResult.texts ? parseResult.texts.length : 0,
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
