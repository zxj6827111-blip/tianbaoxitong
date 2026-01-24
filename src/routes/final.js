const express = require('express');
const { AppError } = require('../errors');

const router = express.Router();
const finalEnabled = process.env.FINAL_ENABLED === 'true';

const buildNotImplementedError = () => new AppError({
  statusCode: 501,
  code: 'NOT_IMPLEMENTED',
  message: 'FINAL stage is reserved for Phase 2'
});

router.get(['/health', '/status'], (req, res, next) => {
  return next(buildNotImplementedError());
});

router.use((req, res, next) => {
  if (!finalEnabled) {
    return next(buildNotImplementedError());
  }
  return next(buildNotImplementedError());
});

module.exports = router;
