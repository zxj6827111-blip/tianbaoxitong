const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { fetchIssues, getDraftOrThrow, runValidation } = require('../services/validationEngine');

const router = express.Router();

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const draftResult = await db.query(
      `SELECT id, unit_id, year, template_version, status, upload_id, created_by, created_at, updated_at
       FROM report_draft
       WHERE id = $1`,
      [req.params.id]
    );

    if (draftResult.rowCount === 0) {
      return next(new AppError({
        statusCode: 404,
        code: 'DRAFT_NOT_FOUND',
        message: 'Draft not found'
      }));
    }

    const draft = draftResult.rows[0];

    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
    const offset = (page - 1) * pageSize;
    const keyFilter = req.query.key || null;

    const factsResult = await db.query(
      `SELECT id, key, value_numeric, evidence, provenance, created_at, updated_at
       FROM facts_budget
       WHERE upload_id = $1
         AND ($2::text IS NULL OR key = $2)
       ORDER BY key ASC
       LIMIT $3 OFFSET $4`,
      [draft.upload_id, keyFilter, pageSize, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM facts_budget
       WHERE upload_id = $1
         AND ($2::text IS NULL OR key = $2)`,
      [draft.upload_id, keyFilter]
    );

    const manualInputsResult = await db.query(
      `SELECT id, key, value_json, value_text, value_numeric, evidence, notes, created_at, updated_at
       FROM manual_inputs
       WHERE draft_id = $1
       ORDER BY key ASC`,
      [draft.id]
    );

    return res.json({
      draft,
      facts_budget: {
        items: factsResult.rows,
        total: Number(countResult.rows[0].total),
        page,
        pageSize
      },
      manual_inputs: manualInputsResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/validate', requireAuth, async (req, res, next) => {
  try {
    const result = await runValidation(req.params.id);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/issues', requireAuth, async (req, res, next) => {
  try {
    await getDraftOrThrow(req.params.id);
    const level = req.query.level || null;
    const issues = await fetchIssues(req.params.id, level);

    return res.json({
      draft_id: req.params.id,
      issues
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/generate', requireAuth, async (req, res, next) => {
  try {
    await getDraftOrThrow(req.params.id);

    let issues = await fetchIssues(req.params.id, null);
    if (issues.length === 0) {
      const validationResult = await runValidation(req.params.id);
      issues = validationResult.issues;
    }

    const fatalIssues = issues.filter((issue) => issue.level === 'FATAL');
    if (fatalIssues.length > 0) {
      return res.status(400).json({
        code: 'FATAL_VALIDATION',
        message: 'Fatal validation issues prevent report generation',
        fatal_count: fatalIssues.length,
        issues
      });
    }

    return res.status(501).json({
      code: 'GEN_NOT_IMPLEMENTED',
      message: 'Report generation is not implemented yet'
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
