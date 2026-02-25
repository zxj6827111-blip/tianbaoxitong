const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const { AppError } = require('../errors');
const {
  requireAuth,
  requireRole,
  requireScope,
  isAdminLike,
  scopeAllowsUnit
} = require('../middleware/auth');
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

const CALIBERS = Object.freeze({
  UNIT: 'unit',
  DEPARTMENT: 'department'
});

const normalizeCaliber = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === CALIBERS.DEPARTMENT) return CALIBERS.DEPARTMENT;
  if (normalized === CALIBERS.UNIT) return CALIBERS.UNIT;
  return null;
};

const getBudgetMappingByCaliber = (caliber) => (
  caliber === CALIBERS.DEPARTMENT ? BUDGET_MAPPING_DEPARTMENT : BUDGET_MAPPING
);

const buildParseCaliberOrder = (preferredCaliber) => {
  const normalizedPreferred = normalizeCaliber(preferredCaliber);
  const order = [];
  if (normalizedPreferred) {
    order.push(normalizedPreferred);
  }
  if (!order.includes(CALIBERS.UNIT)) {
    order.push(CALIBERS.UNIT);
  }
  if (!order.includes(CALIBERS.DEPARTMENT)) {
    order.push(CALIBERS.DEPARTMENT);
  }
  return order;
};

const parseWorkbookWithAutoCaliber = async ({ filePath, preferredCaliber }) => {
  const parseOrder = buildParseCaliberOrder(preferredCaliber);
  const parseErrors = [];

  for (const caliber of parseOrder) {
    try {
      const parseResult = await parseBudgetWorkbook(filePath, getBudgetMappingByCaliber(caliber));
      return { parseResult, caliber };
    } catch (error) {
      parseErrors.push({ caliber, error });
    }
  }

  const preferredError = parseErrors.find((item) => item.caliber === normalizeCaliber(preferredCaliber))?.error;
  throw preferredError || parseErrors[0]?.error || new Error('Failed to parse workbook');
};

router.get('/scope-options', requireAuth, requireRole(['admin', 'maintainer', 'reporter']), requireScope({ enforceWriteGuard: false }), async (req, res, next) => {
  try {
    const adminLike = Boolean(req.scopeMeta?.isAdminLike);
    let whereClause = '';
    let params = [];

    if (!adminLike) {
      if (Array.isArray(req.scopeFilter?.unit_ids) && req.scopeFilter.unit_ids.length > 0) {
        params = [req.scopeFilter.unit_ids];
        whereClause = 'WHERE u.id = ANY($1::uuid[])';
      } else if (req.scopeFilter?.unit_id) {
        params = [req.scopeFilter.unit_id];
        whereClause = 'WHERE u.id = $1';
      } else if (req.scopeFilter?.department_id) {
        params = [req.scopeFilter.department_id];
        whereClause = 'WHERE u.department_id = $1';
      } else {
        return res.json({
          departments: [],
          units: [],
          default_department_id: null,
          default_unit_id: null
        });
      }
    }

    const rowsResult = await db.query(
      `SELECT u.id,
              u.name,
              u.department_id,
              dep.name AS department_name
       FROM org_unit u
       LEFT JOIN org_department dep ON dep.id = u.department_id
       ${whereClause}
       ORDER BY dep.sort_order ASC NULLS LAST,
                dep.name ASC NULLS LAST,
                u.sort_order ASC NULLS LAST,
                u.name ASC,
                u.id ASC`,
      params
    );

    const units = rowsResult.rows.map((row) => ({
      id: String(row.id),
      name: row.name || '',
      department_id: row.department_id ? String(row.department_id) : null,
      department_name: row.department_name || null
    }));

    const departmentMap = new Map();
    units.forEach((unit) => {
      const departmentId = String(unit.department_id || '').trim();
      if (!departmentId || departmentMap.has(departmentId)) return;
      departmentMap.set(departmentId, String(unit.department_name || '').trim() || `部门 ${departmentId.slice(0, 8)}`);
    });

    const departments = Array.from(departmentMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    const defaultDepartmentId = req.scopeFilter?.department_id
      ? String(req.scopeFilter.department_id)
      : (departments.length === 1 ? departments[0].id : null);
    const defaultUnitId = req.scopeFilter?.unit_id
      ? String(req.scopeFilter.unit_id)
      : (units.length === 1 ? units[0].id : null);

    return res.json({
      departments,
      units,
      default_department_id: defaultDepartmentId,
      default_unit_id: defaultUnitId
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole(['admin', 'maintainer', 'reporter']), requireScope(), upload.single('file'), async (req, res, next) => {
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

    // Admin/maintainer can operate on any unit; scoped users can only target assigned unit_ids.
    const adminLike = isAdminLike(req.user);
    const selectedDepartmentId = req.body.department_id
      ? String(req.body.department_id).trim()
      : '';
    const requestedUnitId = req.body.unit_id
      ? String(req.body.unit_id).trim()
      : '';
    const scopedUnitIds = Array.isArray(req.scopeFilter?.unit_ids)
      ? req.scopeFilter.unit_ids.map((value) => String(value))
      : [];
    let resolvedUnitId = '';

    if (adminLike) {
      resolvedUnitId = requestedUnitId;
    } else if (requestedUnitId) {
      if (!scopeAllowsUnit(req.scopeFilter, requestedUnitId)) {
        return next(new AppError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'No permission to operate this unit'
        }));
      }
      resolvedUnitId = requestedUnitId;
    } else if (req.user.unit_id) {
      resolvedUnitId = String(req.user.unit_id);
    } else if (scopedUnitIds.length === 1) {
      resolvedUnitId = scopedUnitIds[0];
    }
    const year = Number(req.body.year);
    const requestedCaliber = normalizeCaliber(req.body.caliber);
    let initialCaliber = requestedCaliber || CALIBERS.UNIT;

    if (!Number.isInteger(year)) {
      return next(new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'year is required'
      }));
    }

    if (selectedDepartmentId) {
      if (resolvedUnitId) {
        const unitDepartmentResult = await db.query(
          `SELECT department_id
           FROM org_unit
           WHERE id = $1`,
          [resolvedUnitId]
        );
        const mappedDepartmentId = unitDepartmentResult.rows[0]?.department_id
          ? String(unitDepartmentResult.rows[0].department_id).trim()
          : '';

        if (!mappedDepartmentId) {
          return next(new AppError({
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'unit_id is invalid'
          }));
        }

        if (mappedDepartmentId !== selectedDepartmentId) {
          return next(new AppError({
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'unit_id does not belong to department_id'
          }));
        }
      } else {
        const fallbackUnitQuery = adminLike
          ? `SELECT id
             FROM org_unit
             WHERE department_id = $1
             ORDER BY
               CASE WHEN name ~ '(本级|机关|本部)' THEN 0 ELSE 1 END,
               sort_order ASC,
               name ASC,
               id ASC
             LIMIT 1`
          : `SELECT id
             FROM org_unit
             WHERE department_id = $1
               AND id = ANY($2::uuid[])
             ORDER BY
               CASE WHEN name ~ '(本级|机关|本部)' THEN 0 ELSE 1 END,
               sort_order ASC,
               name ASC,
               id ASC
             LIMIT 1`;
        const fallbackUnitResult = await db.query(
          fallbackUnitQuery,
          adminLike ? [selectedDepartmentId] : [selectedDepartmentId, scopedUnitIds]
        );

        if (fallbackUnitResult.rowCount === 0) {
          return next(new AppError({
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: adminLike
              ? 'selected department has no units'
              : 'selected department has no accessible units'
          }));
        }

        resolvedUnitId = String(fallbackUnitResult.rows[0].id);
        initialCaliber = CALIBERS.DEPARTMENT;
      }
    }

    if (!resolvedUnitId) {
      return next(new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: adminLike
          ? 'department_id is required; unit_id is optional'
          : (scopedUnitIds.length > 1
            ? 'unit_id is required for current account'
            : 'User has no assigned unit')
      }));
    }

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    // Check for existing upload and delete it (Overwrite strategy)
    // This allows users to re-upload if parsing failed or they want to start over
    const client = await db.pool.connect();
    let oldFilePathToDelete = null;
    let newFilePath = null;
    try {
      await ensureUploadDir();
      await client.query('BEGIN');

      // Find existing upload
      const existing = await client.query(
        'SELECT id, file_name FROM upload_job WHERE unit_id = $1 AND year = $2',
        [resolvedUnitId, year]
      );

      if (existing.rowCount > 0) {
        const oldId = existing.rows[0].id;
        const oldFileName = existing.rows[0].file_name;
        oldFilePathToDelete = getUploadFilePath(oldId, oldFileName);

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
        [resolvedUnitId, year, initialCaliber, req.file.originalname, fileHash, 'UPLOADED', req.user.id]
      );

      const uploadId = insertResult.rows[0].id;
      newFilePath = getUploadFilePath(uploadId, req.file.originalname);
      await fs.writeFile(newFilePath, req.file.buffer);

      await client.query('COMMIT');

      if (oldFilePathToDelete) {
        try {
          await fs.unlink(oldFilePathToDelete);
        } catch {
          // Ignore old-file cleanup failure after commit.
        }
      }

      return res.status(201).json({
        upload_id: uploadId,
        file_hash: insertResult.rows[0].file_hash,
        status: insertResult.rows[0].status
      });

    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failures when transaction is not active.
      }

      if (newFilePath) {
        try {
          await fs.unlink(newFilePath);
        } catch {
          // Ignore cleanup failure for partially-written files.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/parse', requireAuth, requireRole(['admin', 'maintainer', 'reporter']), requireScope(), async (req, res, next) => {
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
    let hasUploadAccess = Boolean(req.scopeMeta?.isAdminLike);
    if (!hasUploadAccess) {
      hasUploadAccess = scopeAllowsUnit(req.scopeFilter, uploadJob.unit_id);
    }
    const hasExplicitUnitScope = Boolean(req.scopeFilter?.unit_id)
      || (Array.isArray(req.scopeFilter?.unit_ids) && req.scopeFilter.unit_ids.length > 0);
    if (!hasUploadAccess && req.scopeFilter?.department_id && !hasExplicitUnitScope) {
      const scopeCheck = await client.query(
        `SELECT 1
         FROM org_unit
         WHERE id = $1
           AND department_id = $2`,
        [uploadJob.unit_id, req.scopeFilter.department_id]
      );
      hasUploadAccess = scopeCheck.rowCount > 0;
    }

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
    const { parseResult, caliber: resolvedCaliber } = await parseWorkbookWithAutoCaliber({
      filePath,
      preferredCaliber: uploadJob.caliber
    });

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
           WHERE department_id = $1
             AND year = $2
             AND report_type = 'BUDGET'
             AND category = $3
             AND unit_id = $4`,
          [departmentId, prevYear, category, uploadJob.unit_id]
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
       SET status = $1,
           caliber = $2,
           updated_at = now()
       WHERE id = $3`,
      ['PARSED', resolvedCaliber, uploadId]
    );

    await client.query('COMMIT');

    return res.json({
      draft_id: draftId,
      upload_id: uploadId,
      extracted_keys_count: parseResult.facts.length,
      extracted_texts_count: parseResult.texts ? parseResult.texts.length : 0,
      caliber: resolvedCaliber,
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

