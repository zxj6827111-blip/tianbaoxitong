const express = require('express');
const { AppError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { HISTORY_ACTUAL_KEYS } = require('../services/historyActualsConfig');
const { lookupHistoryActuals } = require('../repositories/historyRepository');
const { fetchLatestSuggestions } = require('../repositories/suggestionRepository');

const router = express.Router();

const parseKeys = (value) => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(','));
  }
  return String(value).split(',');
};

router.get('/lookup', requireAuth, async (req, res, next) => {
  try {
    const unitId = req.query.unit_id;
    const year = Number(req.query.year);
    const keys = parseKeys(req.query.keys).map((key) => key.trim()).filter(Boolean);

    if (!unitId) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'unit_id is required'
      });
    }
    if (!Number.isInteger(year)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'year is required'
      });
    }
    if (keys.length === 0) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'keys is required'
      });
    }

    const invalidKeys = keys.filter((key) => !HISTORY_ACTUAL_KEYS.includes(key));
    if (invalidKeys.length > 0) {
      throw new AppError({
        statusCode: 400,
        code: 'INVALID_KEYS',
        message: 'Some keys are not allowed',
        details: { invalid_keys: invalidKeys }
      });
    }

    const [rows, suggestions] = await Promise.all([
      lookupHistoryActuals({ unitId, year, keys }),
      fetchLatestSuggestions({ unitId, year, keys })
    ]);

    const values = {};
    rows.forEach((row) => {
      values[row.key] = Number(row.value_numeric);
    });

    suggestions.forEach((row) => {
      if (row.suggest_value_wanyuan !== null && row.suggest_value_wanyuan !== undefined) {
        values[row.key] = Number(row.suggest_value_wanyuan);
      }
    });
    const missingKeys = keys.filter((key) => !(key in values));

    return res.json({
      unit_id: unitId,
      year,
      values,
      missing_keys: missingKeys
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
