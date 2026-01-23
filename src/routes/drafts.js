const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requireAuth } = require('../middleware/auth');

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

module.exports = router;
