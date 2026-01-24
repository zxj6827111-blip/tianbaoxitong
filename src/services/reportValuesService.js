const db = require('../db');
const { fetchLatestSuggestions } = require('../repositories/suggestionRepository');
const { fetchReasonThreshold, getLineItems } = require('./lineItemsService');

const resolveLatestSuggestions = async ({ unitId, year, factsByKey }) => {
  const keys = Array.from(factsByKey.keys());
  const suggestions = await fetchLatestSuggestions({ unitId, year, keys });
  const suggestionMap = new Map();

  for (const suggestion of suggestions) {
    const value = suggestion.suggest_value_wanyuan;
    const parsedValue = value !== null && value !== undefined ? Number(value) : null;
    suggestionMap.set(suggestion.key, parsedValue);
  }

  return suggestionMap;
};

const loadDraftInputs = async (draftId) => {
  const draftResult = await db.query(
    `SELECT id, unit_id, year, upload_id, template_version
     FROM report_draft
     WHERE id = $1`,
    [draftId]
  );

  if (draftResult.rowCount === 0) {
    return null;
  }

  const draft = draftResult.rows[0];

  const factsResult = await db.query(
    `SELECT key, value_numeric
     FROM facts_budget
     WHERE upload_id = $1`,
    [draft.upload_id]
  );

  const manualResult = await db.query(
    `SELECT key, value_json, value_text, value_numeric
     FROM manual_inputs
     WHERE draft_id = $1`,
    [draft.id]
  );

  const threshold = await fetchReasonThreshold();
  const lineItems = await getLineItems({ draftId, uploadId: draft.upload_id, threshold });

  return {
    draft,
    facts: factsResult.rows,
    manualInputs: manualResult.rows,
    lineItems
  };
};

const buildFinalValues = async (draftId) => {
  const payload = await loadDraftInputs(draftId);
  if (!payload) {
    return null;
  }

  const factsByKey = new Map(
    payload.facts.map((row) => [row.key, row.value_numeric !== null ? Number(row.value_numeric) : null])
  );

  const suggestions = await resolveLatestSuggestions({
    unitId: payload.draft.unit_id,
    year: payload.draft.year,
    factsByKey
  });

  const values = {
    facts: {},
    manual_inputs: {},
    line_items_reason: payload.lineItems.map((item) => ({
      item_key: item.item_key,
      item_label: item.item_label,
      amount_current_wanyuan: item.amount_current_wanyuan,
      amount_prev_wanyuan: item.amount_prev_wanyuan,
      change_ratio: item.change_ratio,
      reason_text: item.reason_text,
      reason_required: item.reason_required,
      order_no: item.order_no
    }))
  };

  for (const [key, value] of factsByKey.entries()) {
    const suggestionValue = suggestions.has(key) ? suggestions.get(key) : value;
    values.facts[key] = suggestionValue;
  }

  for (const input of payload.manualInputs) {
    values.manual_inputs[input.key] = {
      value_json: input.value_json ?? null,
      value_text: input.value_text ?? null,
      value_numeric: input.value_numeric !== null && input.value_numeric !== undefined
        ? Number(input.value_numeric)
        : null
    };
  }

  return {
    draft: payload.draft,
    values
  };
};

module.exports = {
  buildFinalValues
};
