const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const {
  getDepartmentTreeWithCounts,
  listUnits,
  getUnitDetail,
  getUnitBadges
} = require('../repositories/orgRepository');

const router = express.Router();

router.get('/_demo/departments', requireAuth, requireRole(['admin', 'maintainer']), async (req, res) => {
  const departments = await getDepartmentTreeWithCounts();
  return res.json({ departments });
});

router.get('/_demo/units', requireAuth, requireRole(['admin', 'maintainer']), async (req, res) => {
  const result = await listUnits({
    page: req.query.page,
    pageSize: req.query.pageSize,
    departmentId: req.query.departmentId,
    q: req.query.q,
    sortBy: req.query.sortBy,
    sortOrder: req.query.sortOrder
  });

  return res.json({ units: result.items, total: result.total });
});

const parseOptionalYear = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid year parameter',
      details: { field: 'year' }
    });
  }
  return parsed;
};

const parsePositiveInt = (value, field, defaultValue) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `Invalid ${field} parameter`,
      details: { field }
    });
  }
  return parsed;
};

const parseFilter = (value) => {
  if (!value) {
    return null;
  }
  const allowed = new Set(['missingArchive', 'pendingSug', 'missingBase']);
  if (!allowed.has(value)) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid filter parameter',
      details: { field: 'filter', allowed: Array.from(allowed) }
    });
  }
  return value;
};

router.get('/departments', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const year = parseOptionalYear(req.query.year);
    const departments = await getDepartmentTreeWithCounts({ year });
    return res.json({ year, departments });
  } catch (error) {
    return next(error);
  }
});

router.get('/units', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const year = parseOptionalYear(req.query.year);
    const page = parsePositiveInt(req.query.page, 'page', 1);
    const pageSize = parsePositiveInt(req.query.pageSize, 'pageSize', 20);
    const filter = parseFilter(req.query.filter);

    const result = await listUnits({
      year,
      page,
      pageSize,
      departmentId: req.query.department_id,
      q: req.query.q,
      filter
    });

    return res.json({
      page,
      pageSize,
      total: result.total,
      units: result.items
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/units/:unitId', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const year = parseOptionalYear(req.query.year);
    const unit = await getUnitDetail({ unitId: req.params.unitId, year });
    if (!unit) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Unit not found'
      });
    }

    return res.json({ unit });
  } catch (error) {
    return next(error);
  }
});

router.get('/units/:unitId/badges', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const year = parseOptionalYear(req.query.year);
    const badges = await getUnitBadges({ unitId: req.params.unitId, year });
    if (!badges) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Unit not found'
      });
    }

    return res.json({ badges });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
