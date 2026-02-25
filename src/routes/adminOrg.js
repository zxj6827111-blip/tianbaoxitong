const express = require('express');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const db = require('../db');

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
const DEFAULT_BATCH_IMPORT_MB = 20;
const configuredBatchImportLimitMb = Number(process.env.ORG_BATCH_IMPORT_MAX_MB || process.env.UPLOAD_MAX_MB || DEFAULT_BATCH_IMPORT_MB);
const maxBatchImportLimitMb = Number.isFinite(configuredBatchImportLimitMb) && configuredBatchImportLimitMb > 0
  ? configuredBatchImportLimitMb
  : DEFAULT_BATCH_IMPORT_MB;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.floor(maxBatchImportLimitMb * 1024 * 1024)
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

const SIMPLE_HEADER_DEPARTMENT = new Set(['部门名称', '部门', 'departmentname', 'deptname']);
const SIMPLE_HEADER_UNIT = new Set(['单位名称', '单位', 'unitname']);
const LEGACY_HEADER_TYPE = new Set(['type', '类型']);
const LEGACY_HEADER_CODE = new Set(['code', '编码']);
const LEGACY_HEADER_NAME = new Set(['name', '名称']);

const normalizeCellText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part?.text || '')).join('').trim();
    }
    if (typeof value.text === 'string') {
      return value.text.trim();
    }
    if (value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }
  }
  return String(value).trim();
};

const normalizeHeader = (value) => normalizeCellText(value).replace(/\s+/g, '').toLowerCase();
const normalizeNameKey = (value) => normalizeCellText(value).toLowerCase();

const parseSortOrder = (value) => {
  const parsed = Number(normalizeCellText(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const generateCode = (prefix) => `${prefix}_${Date.now().toString(36).toUpperCase()}_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const detectImportFormat = (worksheet) => {
  const header1 = normalizeHeader(worksheet.getRow(1).getCell(1).value);
  const header2 = normalizeHeader(worksheet.getRow(1).getCell(2).value);
  const header3 = normalizeHeader(worksheet.getRow(1).getCell(3).value);

  const isSimple = SIMPLE_HEADER_DEPARTMENT.has(header1) && SIMPLE_HEADER_UNIT.has(header2);
  if (isSimple) {
    return 'simplified';
  }

  const isLegacy = LEGACY_HEADER_TYPE.has(header1) && LEGACY_HEADER_CODE.has(header2) && LEGACY_HEADER_NAME.has(header3);
  if (isLegacy) {
    return 'legacy';
  }

  throw new AppError({
    statusCode: 400,
    code: 'INVALID_FILE',
    message: 'Unsupported header format. Use template or legacy Type/Code/Name format.'
  });
};

const appendOrgAuditLog = async ({ client, req, action, meta }) => {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json, ip, user_agent)
     VALUES ($1, $2, 'org_department', NULL, $3, $4, $5)`,
    [
      req.user?.id || null,
      action,
      meta ? JSON.stringify(meta) : null,
      req.ip || null,
      req.headers['user-agent'] || null
    ]
  );
};

const importLegacyWorksheet = async ({ worksheet, client }) => {
  const departments = [];
  const units = [];
  const errors = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const type = normalizeCellText(row.getCell(1).value).toUpperCase();
    const code = normalizeCellText(row.getCell(2).value);
    const name = normalizeCellText(row.getCell(3).value);
    const parentCode = normalizeCellText(row.getCell(4).value);
    const sortOrder = parseSortOrder(row.getCell(5).value);

    if (!type && !code && !name && !parentCode) {
      return;
    }

    if (!type || !code || !name) {
      errors.push({ row: rowNumber, message: 'Missing required fields (Type/Code/Name)' });
      return;
    }

    if (type === 'DEPARTMENT' || type === '部门') {
      departments.push({ code, name, parentCode, sortOrder, rowNumber });
      return;
    }

    if (type === 'UNIT' || type === '单位') {
      units.push({ code, name, parentCode, sortOrder, rowNumber });
      return;
    }

    errors.push({ row: rowNumber, message: `Unknown type: ${type}` });
  });

  if (errors.length > 0) {
    throw new AppError({
      statusCode: 422,
      code: 'IMPORT_VALIDATION_ERROR',
      message: 'Import validation failed',
      details: { errors }
    });
  }

  const deptCodeMap = new Map();
  const existingDeptResult = await client.query('SELECT id, code FROM org_department');
  existingDeptResult.rows.forEach((row) => {
    deptCodeMap.set(String(row.code), String(row.id));
  });

  const insertedDeptIdByCode = new Map();
  for (const dept of departments) {
    const result = await client.query(
      `INSERT INTO org_department (code, name, parent_id, sort_order)
       VALUES ($1, $2, NULL, $3)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
       RETURNING id`,
      [dept.code, dept.name, dept.sortOrder]
    );

    const deptId = String(result.rows[0].id);
    deptCodeMap.set(dept.code, deptId);
    insertedDeptIdByCode.set(dept.code, deptId);
  }

  for (const dept of departments) {
    const currentDeptId = insertedDeptIdByCode.get(dept.code) || deptCodeMap.get(dept.code);
    if (!currentDeptId) {
      errors.push({ row: dept.rowNumber, message: `Department insert failed: ${dept.code}` });
      continue;
    }

    const parentId = dept.parentCode ? deptCodeMap.get(dept.parentCode) : null;
    if (dept.parentCode && !parentId) {
      errors.push({ row: dept.rowNumber, message: `Parent department not found: ${dept.parentCode}` });
      continue;
    }

    await client.query(
      `UPDATE org_department
       SET parent_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [parentId || null, currentDeptId]
    );
  }

  for (const unit of units) {
    const deptId = deptCodeMap.get(unit.parentCode);
    if (!deptId) {
      errors.push({ row: unit.rowNumber, message: `Department not found: ${unit.parentCode}` });
      continue;
    }

    await client.query(
      `INSERT INTO org_unit (code, name, department_id, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           department_id = EXCLUDED.department_id,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()`,
      [unit.code, unit.name, deptId, unit.sortOrder]
    );
  }

  if (errors.length > 0) {
    throw new AppError({
      statusCode: 422,
      code: 'IMPORT_VALIDATION_ERROR',
      message: 'Import validation failed',
      details: { errors }
    });
  }

  return {
    format: 'legacy',
    imported: {
      departments: departments.length,
      units: units.length
    },
    matched: {
      departments: 0,
      units: 0
    },
    errors: []
  };
};

const importSimplifiedWorksheet = async ({ worksheet, client }) => {
  const rows = [];
  const errors = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const departmentName = normalizeCellText(row.getCell(1).value);
    const unitName = normalizeCellText(row.getCell(2).value);

    if (!departmentName && !unitName) {
      return;
    }

    if (!departmentName) {
      errors.push({ row: rowNumber, message: 'Department name is required' });
      return;
    }

    rows.push({
      rowNumber,
      departmentName,
      unitName
    });
  });

  if (errors.length > 0) {
    throw new AppError({
      statusCode: 422,
      code: 'IMPORT_VALIDATION_ERROR',
      message: 'Import validation failed',
      details: { errors }
    });
  }

  if (rows.length === 0) {
    return {
      format: 'simplified',
      imported: { departments: 0, units: 0 },
      matched: { departments: 0, units: 0 },
      errors: []
    };
  }

  const existingDepartments = await client.query('SELECT id, name FROM org_department');
  const departmentIdByName = new Map();
  existingDepartments.rows.forEach((row) => {
    departmentIdByName.set(normalizeNameKey(row.name), String(row.id));
  });

  const nextDepartmentSortResult = await client.query('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM org_department');
  let nextDepartmentSort = Number(nextDepartmentSortResult.rows[0]?.max_sort || -1) + 1;

  let createdDepartmentCount = 0;
  let matchedDepartmentCount = 0;
  const orderedDepartmentNames = [];
  const seenDepartmentKey = new Set();

  rows.forEach((row) => {
    const key = normalizeNameKey(row.departmentName);
    if (seenDepartmentKey.has(key)) return;
    seenDepartmentKey.add(key);
    orderedDepartmentNames.push(row.departmentName);
  });

  for (const departmentName of orderedDepartmentNames) {
    const key = normalizeNameKey(departmentName);
    if (departmentIdByName.has(key)) {
      matchedDepartmentCount += 1;
      continue;
    }

    const insertResult = await client.query(
      `INSERT INTO org_department (code, name, parent_id, sort_order)
       VALUES ($1, $2, NULL, $3)
       RETURNING id`,
      [generateCode('DEPT'), departmentName, nextDepartmentSort]
    );

    nextDepartmentSort += 1;
    createdDepartmentCount += 1;
    departmentIdByName.set(key, String(insertResult.rows[0].id));
  }

  const allDepartmentIds = Array.from(new Set(Array.from(departmentIdByName.values())));
  const existingUnitsResult = await client.query(
    `SELECT id, department_id, name, sort_order
     FROM org_unit
     WHERE department_id = ANY($1::uuid[])`,
    [allDepartmentIds]
  );

  const existingUnitKeySet = new Set();
  const nextUnitSortByDepartment = new Map();
  existingUnitsResult.rows.forEach((row) => {
    const deptId = String(row.department_id);
    existingUnitKeySet.add(`${deptId}::${normalizeNameKey(row.name)}`);
    const current = Number(row.sort_order || 0);
    const known = nextUnitSortByDepartment.get(deptId);
    if (known === undefined || current > known) {
      nextUnitSortByDepartment.set(deptId, current);
    }
  });

  let createdUnitCount = 0;
  let matchedUnitCount = 0;
  for (const row of rows) {
    const unitName = normalizeCellText(row.unitName);
    if (!unitName) {
      continue;
    }

    const departmentId = departmentIdByName.get(normalizeNameKey(row.departmentName));
    if (!departmentId) {
      errors.push({ row: row.rowNumber, message: `Department not found: ${row.departmentName}` });
      continue;
    }

    const unitKey = `${departmentId}::${normalizeNameKey(unitName)}`;
    if (existingUnitKeySet.has(unitKey)) {
      matchedUnitCount += 1;
      continue;
    }

    const previousSort = nextUnitSortByDepartment.get(departmentId);
    const nextSort = Number.isFinite(previousSort) ? previousSort + 1 : 0;

    await client.query(
      `INSERT INTO org_unit (code, name, department_id, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [generateCode('UNIT'), unitName, departmentId, nextSort]
    );

    nextUnitSortByDepartment.set(departmentId, nextSort);
    existingUnitKeySet.add(unitKey);
    createdUnitCount += 1;
  }

  if (errors.length > 0) {
    throw new AppError({
      statusCode: 422,
      code: 'IMPORT_VALIDATION_ERROR',
      message: 'Import validation failed',
      details: { errors }
    });
  }

  return {
    format: 'simplified',
    imported: {
      departments: createdDepartmentCount,
      units: createdUnitCount
    },
    matched: {
      departments: matchedDepartmentCount,
      units: matchedUnitCount
    },
    errors: []
  };
};

// Create Department
router.post('/departments', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    let { code, name, parent_id, sort_order } = req.body;

    if (!name) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Name is required'
      });
    }

    // Auto-generate code if not provided
    if (!code) {
      code = `DEPT_${Date.now()}`;
    }

    const result = await db.query(
      `INSERT INTO org_department (code, name, parent_id, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code, name, parent_id || null, sort_order || 0]
    );

    return res.status(201).json({ department: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Update Department
router.put('/departments/:id', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { code, name, parent_id, sort_order } = req.body;

    const result = await db.query(
      `UPDATE org_department
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           parent_id = $3,
           sort_order = COALESCE($4, sort_order),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [code, name, parent_id, sort_order, req.params.id]
    );

    if (result.rows.length === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Department not found'
      });
    }

    return res.json({ department: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Delete Department
router.delete('/departments/:id', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const deptId = req.params.id;
    const force = req.query.force === 'true';

    // Check if department has units
    const unitsResult = await client.query(
      'SELECT id FROM org_unit WHERE department_id = $1',
      [deptId]
    );

    if (unitsResult.rowCount > 0) {
      if (!force) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          code: 'DEPARTMENT_HAS_UNITS',
          message: 'Cannot delete department with units',
          unitCount: unitsResult.rowCount
        });
      }

      // Force delete: Delete all units and their dependencies
      console.log(`[DELETE] Force deleting department ${deptId} with ${unitsResult.rowCount} units`);

      for (const unit of unitsResult.rows) {
        const unitId = unit.id;
        // Delete dependent data for each unit
        await client.query('DELETE FROM upload_job WHERE unit_id = $1', [unitId]);
        await client.query('DELETE FROM history_actuals WHERE unit_id = $1', [unitId]);
        await client.query('DELETE FROM correction_suggestion WHERE unit_id = $1', [unitId]);
        await client.query('DELETE FROM report_draft WHERE unit_id = $1', [unitId]);

        // Delete the unit
        await client.query('DELETE FROM org_unit WHERE id = $1', [unitId]);
      }
    }

    const result = await client.query(
      'DELETE FROM org_department WHERE id = $1 RETURNING *',
      [deptId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Department not found'
      });
    }

    await client.query('COMMIT');
    return res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

// Create Unit
router.post('/units', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    let { code, name, department_id, sort_order } = req.body;

    if (!name || !department_id) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Name and department_id are required'
      });
    }

    // Auto-generate code if not provided
    if (!code) {
      code = `UNIT_${Date.now()}`;
    }

    const result = await db.query(
      `INSERT INTO org_unit (code, name, department_id, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code, name, department_id, sort_order || 0]
    );

    return res.status(201).json({ unit: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Update Unit
router.put('/units/:id', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { code, name, department_id, sort_order } = req.body;

    const result = await db.query(
      `UPDATE org_unit
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           department_id = COALESCE($3, department_id),
           sort_order = COALESCE($4, sort_order),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [code, name, department_id, sort_order, req.params.id]
    );

    if (result.rows.length === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Unit not found'
      });
    }

    return res.json({ unit: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Delete Unit
router.delete('/units/:id', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const unitId = req.params.id;
    console.log(`[DELETE] Attempting to delete unit: ${unitId}`);

    // 1. Delete dependent data
    // Note: Some tables have ON DELETE RESTRICT, so we must delete children first
    const delJobs = await client.query('DELETE FROM upload_job WHERE unit_id = $1 RETURNING id', [unitId]);
    console.log(`[DELETE] Deleted ${delJobs.rowCount} upload_jobs`);
    await client.query('DELETE FROM history_actuals WHERE unit_id = $1', [unitId]);
    await client.query('DELETE FROM correction_suggestion WHERE unit_id = $1', [unitId]);
    await client.query('DELETE FROM report_draft WHERE unit_id = $1', [unitId]);
    // users table sets unit_id to NULL on delete, so no need to delete users

    // 2. Delete the unit itself
    const result = await client.query(
      'DELETE FROM org_unit WHERE id = $1 RETURNING *',
      [unitId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Unit not found'
      });
    }

    await client.query('COMMIT');
    return res.json({ success: true, unit: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});


// Reorder Items (Departments or Units)
router.post('/reorder', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { type, items } = req.body; // type: 'department' | 'unit', items: [{id, sort_order}]

    if (!type || !items || !Array.isArray(items)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Type and items array are required'
      });
    }

    const tableByType = {
      department: 'org_department',
      unit: 'org_unit'
    };

    const table = tableByType[type];
    if (!table) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: "type must be either 'department' or 'unit'"
      });
    }

    await client.query('BEGIN');

    for (const item of items) {
      const sortOrder = Number(item?.sort_order);
      if (!item?.id || !Number.isFinite(sortOrder)) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Each item requires id and numeric sort_order'
        });
      }

      await client.query(
        `UPDATE ${table} SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
        [sortOrder, item.id]
      );
    }

    await client.query('COMMIT');

    return res.json({ success: true, updated: items.length });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/template', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('组织架构导入模板');
    worksheet.columns = [
      { header: '部门名称', key: 'department_name', width: 28 },
      { header: '单位名称', key: 'unit_name', width: 28 },
      { header: '备注', key: 'remark', width: 36 }
    ];

    worksheet.addRow({ department_name: '财政局', unit_name: '国库支付中心', remark: '' });
    worksheet.addRow({ department_name: '财政局', unit_name: '绩效评价中心', remark: '' });
    worksheet.addRow({ department_name: '教育局', unit_name: '', remark: '仅创建部门可留空单位名称' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="org_import_template.xlsx"');
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return next(error);
  }
});

router.get('/export', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const rowsResult = await db.query(
      `SELECT d.code AS department_code,
              d.name AS department_name,
              d.sort_order AS department_sort_order,
              u.code AS unit_code,
              u.name AS unit_name,
              u.sort_order AS unit_sort_order
       FROM org_department d
       LEFT JOIN org_unit u ON u.department_id = d.id
       ORDER BY d.sort_order ASC, d.name ASC, u.sort_order ASC, u.name ASC`
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('组织架构导出');
    worksheet.columns = [
      { header: '部门名称', key: 'department_name', width: 28 },
      { header: '单位名称', key: 'unit_name', width: 28 },
      { header: '部门编码', key: 'department_code', width: 20 },
      { header: '单位编码', key: 'unit_code', width: 20 },
      { header: '部门排序', key: 'department_sort_order', width: 12 },
      { header: '单位排序', key: 'unit_sort_order', width: 12 }
    ];

    rowsResult.rows.forEach((row) => {
      worksheet.addRow({
        department_name: row.department_name || '',
        unit_name: row.unit_name || '',
        department_code: row.department_code || '',
        unit_code: row.unit_code || '',
        department_sort_order: Number(row.department_sort_order || 0),
        unit_sort_order: row.unit_sort_order === null || row.unit_sort_order === undefined
          ? ''
          : Number(row.unit_sort_order)
      });
    });

    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="org_export_${stamp}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return next(error);
  }
});

// Batch Import from Excel (supports simplified and legacy headers)
router.post('/batch-import', requireAuth, requireRole(['admin', 'maintainer']), upload.single('file'), async (req, res, next) => {
  const client = await db.getClient();
  try {
    if (!req.file) {
      throw new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'Excel file is required'
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new AppError({
        statusCode: 400,
        code: 'INVALID_FILE',
        message: 'No worksheet found in Excel file'
      });
    }

    const format = detectImportFormat(worksheet);
    await client.query('BEGIN');

    const importResult = format === 'simplified'
      ? await importSimplifiedWorksheet({ worksheet, client })
      : await importLegacyWorksheet({ worksheet, client });

    await appendOrgAuditLog({
      client,
      req,
      action: 'ORG_BATCH_IMPORTED',
      meta: {
        format: importResult.format,
        imported: importResult.imported,
        matched: importResult.matched,
        source_file_name: req.file.originalname,
        file_size: req.file.size
      }
    });

    await client.query('COMMIT');
    return res.json({
      success: true,
      ...importResult
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors when transaction already ended.
    }
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
