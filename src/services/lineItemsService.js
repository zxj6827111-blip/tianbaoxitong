const db = require('../db');

const DEFAULT_REASON_THRESHOLD = 0.1;

const LINE_ITEM_DEFINITIONS = [
  {
    item_key: 'fiscal_grant_expenditure_personnel',
    label: '人员经费',
    current_key: 'fiscal_grant_expenditure_personnel',
    prev_key: 'fiscal_grant_expenditure_personnel_prev',
    order_no: 1
  },
  {
    item_key: 'fiscal_grant_expenditure_public',
    label: '公用经费',
    current_key: 'fiscal_grant_expenditure_public',
    prev_key: 'fiscal_grant_expenditure_public_prev',
    order_no: 2
  },
  {
    item_key: 'fiscal_grant_expenditure_project',
    label: '项目支出',
    current_key: 'fiscal_grant_expenditure_project',
    prev_key: 'fiscal_grant_expenditure_project_prev',
    order_no: 3
  }
];

const LINE_ITEM_KEY_SET = new Set(LINE_ITEM_DEFINITIONS.map((item) => item.item_key));

const resolveReasonThreshold = (threshold) => {
  const parsed = Number(threshold);
  return Number.isFinite(parsed) ? parsed : DEFAULT_REASON_THRESHOLD;
};

const isReasonRequired = (current, prev, threshold) => {
  if (prev === null || prev === undefined) {
    return false;
  }
  if (current === null || current === undefined) {
    return false;
  }
  if (prev === 0) {
    return current !== 0;
  }
  const ratio = Math.abs(current - prev) / Math.abs(prev);
  return ratio >= threshold;
};

const buildLineItemsPreview = (items) => {
  if (!items || items.length === 0) {
    return '';
  }

  const selected = items.slice(0, 3);
  return selected.map((item) => {
    const amountText = item.amount_current_wanyuan === null || item.amount_current_wanyuan === undefined
      ? '金额待补充'
      : `${item.amount_current_wanyuan}万元`;
    const reasonText = item.reason_text && item.reason_text.trim()
      ? item.reason_text.trim()
      : '未填写原因';
    return `${item.item_label}${amountText}：${reasonText}`;
  }).join('；');
};

const fetchReasonThreshold = async () => {
  const result = await db.query(
    `SELECT params_json
     FROM validation_rule_config
     WHERE rule_id = $1`,
    ['REASON_REQUIRED_MISSING']
  );

  if (result.rowCount === 0) {
    return DEFAULT_REASON_THRESHOLD;
  }

  const params = result.rows[0].params_json || {};
  return resolveReasonThreshold(params.threshold);
};

const getLineItemDefinition = (itemKey) => LINE_ITEM_DEFINITIONS.find((item) => item.item_key === itemKey);

const getLineItems = async ({ draftId, uploadId, threshold }) => {
  const resolvedThreshold = threshold === undefined || threshold === null
    ? DEFAULT_REASON_THRESHOLD
    : resolveReasonThreshold(threshold);
  const factKeys = Array.from(new Set([
    ...LINE_ITEM_DEFINITIONS.map((item) => item.current_key),
    ...LINE_ITEM_DEFINITIONS.map((item) => item.prev_key).filter(Boolean)
  ]));

  const factsResult = await db.query(
    `SELECT key, value_numeric
     FROM facts_budget
     WHERE upload_id = $1
       AND key = ANY($2)`,
    [uploadId, factKeys]
  );

  const factsMap = new Map(
    factsResult.rows.map((row) => [row.key, row.value_numeric !== null ? Number(row.value_numeric) : null])
  );

  const reasonsResult = await db.query(
    `SELECT item_key, reason_text, order_no, sort_order
     FROM line_items_reason
     WHERE draft_id = $1`,
    [draftId]
  );

  const reasonMap = new Map(
    reasonsResult.rows.map((row) => [row.item_key, row])
  );

  const items = LINE_ITEM_DEFINITIONS.map((definition) => {
    const currentValue = factsMap.has(definition.current_key)
      ? factsMap.get(definition.current_key)
      : null;
    const prevValue = definition.prev_key && factsMap.has(definition.prev_key)
      ? factsMap.get(definition.prev_key)
      : null;
    const changeRatio = (prevValue === null || prevValue === 0 || currentValue === null)
      ? null
      : Math.abs(currentValue - prevValue) / Math.abs(prevValue);
    const storedReason = reasonMap.get(definition.item_key);
    const orderNo = storedReason?.order_no ?? storedReason?.sort_order ?? definition.order_no;

    return {
      item_key: definition.item_key,
      item_label: definition.label,
      amount_current_wanyuan: currentValue,
      amount_prev_wanyuan: prevValue,
      change_ratio: changeRatio,
      reason_text: storedReason?.reason_text ?? null,
      reason_required: isReasonRequired(currentValue, prevValue, resolvedThreshold),
      order_no: orderNo
    };
  });

  return items.sort((left, right) => left.order_no - right.order_no);
};

module.exports = {
  DEFAULT_REASON_THRESHOLD,
  LINE_ITEM_DEFINITIONS,
  LINE_ITEM_KEY_SET,
  buildLineItemsPreview,
  fetchReasonThreshold,
  getLineItemDefinition,
  getLineItems,
  resolveReasonThreshold
};
