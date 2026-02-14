const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const db = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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

    const table = type === 'department' ? 'org_department' : 'org_unit';

    await client.query('BEGIN');

    for (const item of items) {
      await client.query(
        `UPDATE ${table} SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
        [item.sort_order, item.id]
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

// Batch Import from Excel
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

    await client.query('BEGIN');

    const departments = [];
    const units = [];
    const errors = [];

    // Expected columns: Type, Code, Name, Parent_Code, Sort_Order
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const type = row.getCell(1).value;
      const code = row.getCell(2).value;
      const name = row.getCell(3).value;
      const parentCode = row.getCell(4).value;
      const sortOrder = row.getCell(5).value || 0;

      if (!type || !code || !name) {
        errors.push({ row: rowNumber, message: 'Missing required fields' });
        return;
      }

      if (type === 'DEPARTMENT' || type === '部门') {
        departments.push({ code, name, parentCode, sortOrder, rowNumber });
      } else if (type === 'UNIT' || type === '单位') {
        units.push({ code, name, parentCode, sortOrder, rowNumber });
      } else {
        errors.push({ row: rowNumber, message: `Unknown type: ${type}` });
      }
    });

    // Insert/Update Departments
    const deptCodeMap = new Map();
    for (const dept of departments) {
      const parentId = dept.parentCode ? deptCodeMap.get(dept.parentCode) : null;

      const result = await client.query(
        `INSERT INTO org_department (code, name, parent_id, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order, updated_at = NOW()
         RETURNING id`,
        [dept.code, dept.name, parentId, dept.sortOrder]
      );

      deptCodeMap.set(dept.code, result.rows[0].id);
    }

    // Insert/Update Units
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
         SET name = EXCLUDED.name, department_id = EXCLUDED.department_id, sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
        [unit.code, unit.name, deptId, unit.sortOrder]
      );
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      imported: {
        departments: departments.length,
        units: units.length
      },
      errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
