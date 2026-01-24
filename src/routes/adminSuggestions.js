const express = require('express');
const { AppError } = require('../errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const db = require('../db');
const { findLockedUnitYears, upsertHistoryActualFromSuggestion } = require('../repositories/historyRepository');
const {
  listAdminSuggestions,
  getSuggestionById,
  updateSuggestionStatus
} = require('../repositories/suggestionRepository');

const router = express.Router();

const parseStatus = (value) => {
  if (!value) {
    return 'PENDING';
  }
  const normalized = String(value).toUpperCase();
  const allowed = new Set(['PENDING', 'APPROVED', 'REJECTED']);
  if (!allowed.has(normalized)) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid status parameter',
      details: { field: 'status', allowed: Array.from(allowed) }
    });
  }
  return normalized;
};

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

router.get('/', requireAuth, requireRole(['admin']), async (req, res, next) => {
  try {
    const status = parseStatus(req.query.status);
    const year = parseOptionalYear(req.query.year);
    const page = parsePositiveInt(req.query.page, 'page', 1);
    const pageSize = parsePositiveInt(req.query.pageSize, 'pageSize', 20);
    const departmentId = req.query.department_id || null;

    const result = await listAdminSuggestions({
      status,
      year,
      departmentId,
      page,
      pageSize
    });

    return res.json({
      page,
      pageSize,
      total: result.total,
      suggestions: result.items
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/approve', requireAuth, requireRole(['admin']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const suggestion = await getSuggestionById(req.params.id, client);
    if (!suggestion) {
      throw new AppError({
        statusCode: 404,
        code: 'SUGGESTION_NOT_FOUND',
        message: 'Suggestion not found'
      });
    }

    if (suggestion.status !== 'PENDING') {
      throw new AppError({
        statusCode: 409,
        code: 'SUGGESTION_ALREADY_REVIEWED',
        message: 'Suggestion has already been reviewed'
      });
    }

    if (suggestion.suggest_value_wanyuan === null || suggestion.suggest_value_wanyuan === undefined) {
      throw new AppError({
        statusCode: 422,
        code: 'SUGGESTION_VALUE_MISSING',
        message: 'suggest_value is required for approval'
      });
    }

    const locked = await findLockedUnitYears(
      client,
      [suggestion.unit_id],
      [suggestion.year]
    );
    if (locked.length > 0) {
      throw new AppError({
        statusCode: 409,
        code: 'HISTORY_LOCKED',
        message: 'History actuals are locked for the given unit and year'
      });
    }

    await upsertHistoryActualFromSuggestion({
      client,
      unitId: suggestion.unit_id,
      year: suggestion.year,
      key: suggestion.key,
      valueNumeric: suggestion.suggest_value_wanyuan,
      suggestionId: suggestion.id
    });

    const updated = await updateSuggestionStatus(suggestion.id, 'APPROVED', req.user.id, client);
    await client.query('COMMIT');
    return res.json({ suggestion: updated });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/:id/reject', requireAuth, requireRole(['admin']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const suggestion = await getSuggestionById(req.params.id, client);
    if (!suggestion) {
      throw new AppError({
        statusCode: 404,
        code: 'SUGGESTION_NOT_FOUND',
        message: 'Suggestion not found'
      });
    }

    if (suggestion.status !== 'PENDING') {
      throw new AppError({
        statusCode: 409,
        code: 'SUGGESTION_ALREADY_REVIEWED',
        message: 'Suggestion has already been reviewed'
      });
    }

    const updated = await updateSuggestionStatus(suggestion.id, 'REJECTED', req.user.id, client);
    await client.query('COMMIT');
    return res.json({ suggestion: updated });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
