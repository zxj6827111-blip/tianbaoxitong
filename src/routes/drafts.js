const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { HISTORY_ACTUAL_KEYS } = require('../services/historyActualsConfig');
const {
  LINE_ITEM_KEY_SET,
  buildLineItemsPreview,
  fetchReasonThreshold,
  getLineItemDefinition,
  getLineItems
} = require('../services/lineItemsService');
const { fetchIssues, getDraftOrThrow, runValidation } = require('../services/validationEngine');
const { generateReportVersion } = require('../services/reportService');
const { createSuggestion, listDraftSuggestions } = require('../repositories/suggestionRepository');

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

router.post('/:id/suggestions', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftOrThrow(req.params.id);
    const key = req.body?.key;
    const oldValue = req.body?.old_value;
    const suggestValue = req.body?.suggest_value;
    const reason = req.body?.reason;
    const attachments = req.body?.attachments ?? null;

    if (!key || typeof key !== 'string' || !HISTORY_ACTUAL_KEYS.includes(key)) {
      throw new AppError({
        statusCode: 422,
        code: 'SUGGESTION_KEY_INVALID',
        message: 'Invalid suggestion key'
      });
    }

    if (suggestValue === null || suggestValue === undefined || Number.isNaN(Number(suggestValue))) {
      throw new AppError({
        statusCode: 422,
        code: 'SUGGESTION_VALUE_INVALID',
        message: 'suggest_value must be a number'
      });
    }

    if (oldValue !== null && oldValue !== undefined && Number.isNaN(Number(oldValue))) {
      throw new AppError({
        statusCode: 422,
        code: 'SUGGESTION_OLD_VALUE_INVALID',
        message: 'old_value must be a number'
      });
    }

    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      throw new AppError({
        statusCode: 422,
        code: 'SUGGESTION_REASON_INVALID',
        message: 'reason must be a string'
      });
    }

    if (attachments !== null && attachments !== undefined && typeof attachments !== 'object') {
      throw new AppError({
        statusCode: 422,
        code: 'SUGGESTION_ATTACHMENTS_INVALID',
        message: 'attachments must be an object or array'
      });
    }

    const unitResult = await db.query(
      `SELECT department_id
       FROM org_unit
       WHERE id = $1`,
      [draft.unit_id]
    );

    const suggestion = await createSuggestion({
      draftId: draft.id,
      unitId: draft.unit_id,
      departmentId: unitResult.rows[0]?.department_id || null,
      year: draft.year,
      key,
      oldValueWanyuan: oldValue === null || oldValue === undefined ? null : Number(oldValue),
      suggestValueWanyuan: Number(suggestValue),
      reason: reason === undefined ? null : reason,
      attachments,
      createdBy: req.user.id
    });

    return res.status(201).json({ suggestion });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/suggestions', requireAuth, async (req, res, next) => {
  try {
    await getDraftOrThrow(req.params.id);
    const suggestions = await listDraftSuggestions(req.params.id);
    return res.json({ draft_id: req.params.id, suggestions });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/line-items', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftOrThrow(req.params.id);
    const threshold = await fetchReasonThreshold();
    const items = await getLineItems({
      draftId: draft.id,
      uploadId: draft.upload_id,
      threshold
    });

    return res.json({
      draft_id: draft.id,
      threshold,
      items,
      preview_text: buildLineItemsPreview(items)
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/line-items', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftOrThrow(req.params.id);
    const payloadItems = req.body?.items;

    if (!Array.isArray(payloadItems)) {
      throw new AppError({
        statusCode: 400,
        code: 'LINE_ITEMS_INVALID',
        message: 'items must be an array'
      });
    }

    const normalizedItems = payloadItems.map((item) => {
      const itemKey = item?.item_key;
      if (!itemKey || typeof itemKey !== 'string' || !LINE_ITEM_KEY_SET.has(itemKey)) {
        throw new AppError({
          statusCode: 400,
          code: 'LINE_ITEM_KEY_INVALID',
          message: `Invalid line item key: ${itemKey}`
        });
      }

      const reasonText = item.reason_text === undefined || item.reason_text === null
        ? null
        : String(item.reason_text);
      const definition = getLineItemDefinition(itemKey);
      const orderNo = item.order_no === undefined || item.order_no === null
        ? definition.order_no
        : Number(item.order_no);

      if (!Number.isFinite(orderNo)) {
        throw new AppError({
          statusCode: 400,
          code: 'LINE_ITEM_ORDER_INVALID',
          message: `Invalid order_no for line item: ${itemKey}`
        });
      }

      return {
        item_key: itemKey,
        reason_text: reasonText,
        order_no: orderNo
      };
    });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const item of normalizedItems) {
        await client.query(
          `INSERT INTO line_items_reason (draft_id, item_key, reason_text, order_no, sort_order, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (draft_id, item_key)
           DO UPDATE SET
             reason_text = EXCLUDED.reason_text,
             order_no = EXCLUDED.order_no,
             sort_order = EXCLUDED.sort_order,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
          [
            draft.id,
            item.item_key,
            item.reason_text,
            item.order_no,
            item.order_no,
            req.user.id
          ]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const threshold = await fetchReasonThreshold();
    const items = await getLineItems({
      draftId: draft.id,
      uploadId: draft.upload_id,
      threshold
    });

    return res.json({
      draft_id: draft.id,
      threshold,
      items,
      preview_text: buildLineItemsPreview(items)
    });
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

    const result = await generateReportVersion({
      draftId: req.params.id,
      userId: req.user.id
    });

    return res.status(201).json({
      report_version_id: result.reportVersionId
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
