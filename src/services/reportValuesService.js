const db = require('../db');
const { fetchLatestSuggestions } = require('../repositories/suggestionRepository');
const { fetchReasonThreshold, getLineItems } = require('./lineItemsService');
const { getUploadFilePath } = require('./uploadStorage');
const { sanitizeManualTextByKey } = require('./manualTextSanitizer');

const toWanyuanFromYuan = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed / 10000;
};

const formatAmount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '\u5f85\u8865\u5145';
  }
  return parsed.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseNumeric = (value) => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const isLikelyValidUnitName = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^\d+$/.test(text)) return false;
  return true;
};

const findRowValue = (rows, keywords, options = {}) => {
  if (!Array.isArray(rows)) return null;
  const exclude = options.exclude || [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const textCells = row.filter((cell) => {
      const cellText = String(cell || '').trim();
      if (!cellText) return false;
      return parseNumeric(cellText) === null;
    });
    const rowText = textCells.join('');
    if (!rowText) continue;
    if (exclude.some((keyword) => rowText.includes(keyword))) {
      continue;
    }
    if (!keywords.some((keyword) => rowText.includes(keyword))) {
      continue;
    }

    for (let idx = row.length - 1; idx >= 0; idx -= 1) {
      const number = parseNumeric(row[idx]);
      if (number !== null) {
        return number;
      }
    }
  }
  return null;
};

const extractPreviousBudgetValues = async ({ unitId, year }) => {
  if (!unitId || !year) return {};
  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) return {};

  const unitResult = await db.query(
    `SELECT department_id
     FROM org_unit
     WHERE id = $1`,
    [unitId]
  );

  const departmentId = unitResult.rows[0]?.department_id || null;
  if (!departmentId) return {};

  const tableResult = await db.query(
    `SELECT table_key, data_json
     FROM org_dept_table_data
     WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET'`,
    [departmentId, prevYear]
  );

  const tableMap = new Map();
  tableResult.rows.forEach((row) => {
    let rows = row.data_json;
    if (typeof rows === 'string') {
      try {
        rows = JSON.parse(rows);
      } catch (error) {
        rows = [];
      }
    }
    if (!Array.isArray(rows)) {
      rows = [];
    }
    tableMap.set(row.table_key, rows);
  });

  return {
    budget_revenue_total: findRowValue(tableMap.get('income_summary'), ['收入合计', '收入总计']),
    budget_revenue_fiscal: findRowValue(tableMap.get('income_summary'), ['财政拨款收入']),
    budget_revenue_business: findRowValue(tableMap.get('income_summary'), ['事业收入']),
    budget_revenue_operation: findRowValue(tableMap.get('income_summary'), ['事业单位经营收入', '经营收入']),
    budget_revenue_other: findRowValue(tableMap.get('income_summary'), ['其他收入']),
    budget_expenditure_total: findRowValue(tableMap.get('expenditure_summary'), ['支出合计', '支出总计']),
    budget_expenditure_basic: findRowValue(tableMap.get('expenditure_summary'), ['基本支出']),
    budget_expenditure_project: findRowValue(tableMap.get('expenditure_summary'), ['项目支出']),
    fiscal_grant_expenditure_total: findRowValue(tableMap.get('fiscal_grant_summary'), ['财政拨款支出', '支出合计'], { exclude: ['收入'] }),
    fiscal_grant_expenditure_general: findRowValue(tableMap.get('fiscal_grant_summary'), ['一般公共预算'], { exclude: ['收入'] }),
    fiscal_grant_expenditure_gov_fund: findRowValue(tableMap.get('fiscal_grant_summary'), ['政府性基金'], { exclude: ['收入'] }),
    fiscal_grant_expenditure_capital: findRowValue(tableMap.get('fiscal_grant_summary'), ['国有资本经营预算'], { exclude: ['收入'] })
  };
};

const buildDeltaText = (current, prev, prevYear) => {
  const currentNumber = toWanyuanFromYuan(current);
  const prevNumber = toWanyuanFromYuan(prev);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(prevNumber)) {
    return `\u6bd4${prevYear}\u5e74\u9884\u7b97\u6682\u65e0\u53ef\u6bd4\u6570\u636e`;
  }
  const diff = currentNumber - prevNumber;
  if (Math.abs(diff) < 0.0001) {
    return `\u4e0e${prevYear}\u5e74\u9884\u7b97\u6301\u5e73`;
  }
  const verb = diff > 0 ? '\u589e\u52a0' : '\u51cf\u5c11';
  return `\u6bd4${prevYear}\u5e74\u9884\u7b97${verb}${formatAmount(Math.abs(diff))}\u4e07\u5143`;
};

/**
 * Fetch the previous year's EXPLANATION_CHANGE_REASON text from org_dept_text_content.
 * Returns the reason text or empty string if not found.
 */
const fetchPreviousChangeReason = async ({ unitId, year }) => {
  if (!unitId || !year) return '';
  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) return '';

  const unitResult = await db.query(
    'SELECT department_id FROM org_unit WHERE id = $1',
    [unitId]
  );
  const departmentId = unitResult.rows[0]?.department_id || null;
  if (!departmentId) return '';

  const result = await db.query(
    `SELECT content_text
     FROM org_dept_text_content
     WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET' AND category = 'EXPLANATION_CHANGE_REASON'`,
    [departmentId, prevYear]
  );

  return result.rows[0]?.content_text || '';
};

const buildBudgetExplanationText = ({ unitName, year, current, previous, changeReason }) => {
  if (!year) return '';
  const prevYear = Number(year) - 1;
  const name = unitName || '\u672c\u5355\u4f4d';

  const revenueText = `${year}\u5e74\uff0c${name}\u6536\u5165\u9884\u7b97${formatAmount(toWanyuanFromYuan(current.budget_revenue_total))}\u4e07\u5143\uff0c\u5176\u4e2d\uff1a\u8d22\u653f\u62e8\u6b3e\u6536\u5165${formatAmount(toWanyuanFromYuan(current.budget_revenue_fiscal))}\u4e07\u5143\uff0c${buildDeltaText(current.budget_revenue_fiscal, previous.budget_revenue_fiscal, prevYear)}\uff1b\u4e8b\u4e1a\u6536\u5165${formatAmount(toWanyuanFromYuan(current.budget_revenue_business))}\u4e07\u5143\uff1b\u4e8b\u4e1a\u5355\u4f4d\u7ecf\u8425\u6536\u5165${formatAmount(toWanyuanFromYuan(current.budget_revenue_operation))}\u4e07\u5143\uff1b\u5176\u4ed6\u6536\u5165${formatAmount(toWanyuanFromYuan(current.budget_revenue_other))}\u4e07\u5143\u3002`;

  const expenditureText = `\u652f\u51fa\u9884\u7b97${formatAmount(toWanyuanFromYuan(current.budget_expenditure_total))}\u4e07\u5143\uff0c\u5176\u4e2d\uff1a\u8d22\u653f\u62e8\u6b3e\u652f\u51fa\u9884\u7b97${formatAmount(toWanyuanFromYuan(current.fiscal_grant_expenditure_total))}\u4e07\u5143\uff0c${buildDeltaText(current.fiscal_grant_expenditure_total, previous.fiscal_grant_expenditure_total, prevYear)}\u3002\u8d22\u653f\u62e8\u6b3e\u652f\u51fa\u9884\u7b97\u4e2d\uff0c\u4e00\u822c\u516c\u5171\u9884\u7b97\u62e8\u6b3e\u652f\u51fa\u9884\u7b97${formatAmount(toWanyuanFromYuan(current.fiscal_grant_expenditure_general))}\u4e07\u5143\uff0c${buildDeltaText(current.fiscal_grant_expenditure_general, previous.fiscal_grant_expenditure_general, prevYear)}\uff1b\u653f\u5e9c\u6027\u57fa\u91d1\u62e8\u6b3e\u652f\u51fa\u9884\u7b97${formatAmount(toWanyuanFromYuan(current.fiscal_grant_expenditure_gov_fund))}\u4e07\u5143\uff0c${buildDeltaText(current.fiscal_grant_expenditure_gov_fund, previous.fiscal_grant_expenditure_gov_fund, prevYear)}\uff1b\u56fd\u6709\u8d44\u672c\u7ecf\u8425\u9884\u7b97\u62e8\u6b3e\u652f\u51fa\u9884\u7b97${formatAmount(toWanyuanFromYuan(current.fiscal_grant_expenditure_capital))}\u4e07\u5143\uff0c${buildDeltaText(current.fiscal_grant_expenditure_capital, previous.fiscal_grant_expenditure_capital, prevYear)}\u3002`;

  // Append change reason if available from previous year
  const reasonLine = changeReason
    ? `\n\u8d22\u653f\u62e8\u6b3e\u6536\u5165\u652f\u51fa\u53d8\u5316\u7684\u4e3b\u8981\u539f\u56e0\u662f${changeReason}\u3002`
    : '';

  return `${revenueText}\n${expenditureText}${reasonLine}`;
};

const shouldRegenerateBudgetExplanation = (text) => {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Old generated content may mistakenly use "yuan" values but append "万元".
  // If any displayed amount in "万元" is implausibly large, regenerate safely.
  const matches = Array.from(text.matchAll(/([0-9][0-9,]*\.?[0-9]*)\s*万元/g));
  if (matches.length === 0) {
    return false;
  }

  return matches.some((match) => {
    const value = Number(String(match[1] || '').replace(/,/g, ''));
    return Number.isFinite(value) && value > 1000000;
  });
};

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
    `SELECT d.id, d.unit_id, d.year, d.upload_id, d.template_version, u.file_name, u.caliber
     FROM report_draft d
     JOIN upload_job u ON u.id = d.upload_id
     WHERE d.id = $1`,
    [draftId]
  );

  if (draftResult.rowCount === 0) {
    return null;
  }

  const draft = draftResult.rows[0];
  const uploadFilePath = getUploadFilePath(draft.upload_id, draft.file_name);

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
  const lineItems = await getLineItems({
    draftId,
    uploadId: draft.upload_id,
    threshold,
    unitId: draft.unit_id,
    year: draft.year
  });

  return {
    draft,
    facts: factsResult.rows,
    manualInputs: manualResult.rows,
    lineItems,
    uploadFilePath
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
    const sanitizedValueText = sanitizeManualTextByKey(input.key, input.value_text);
    values.manual_inputs[input.key] = {
      value_json: input.value_json ?? null,
      value_text: sanitizedValueText ?? null,
      value_numeric: input.value_numeric !== null && input.value_numeric !== undefined
        ? Number(input.value_numeric)
        : null
      };
  }

  const unitResult = await db.query(
    `SELECT name
     FROM org_unit
     WHERE id = $1`,
    [payload.draft.unit_id]
  );
  const orgUnitName = String(unitResult.rows[0]?.name || '').trim();
  const currentUnitName = String(values.manual_inputs.unit_full_name?.value_text || '').trim();
  if (isLikelyValidUnitName(orgUnitName) && !isLikelyValidUnitName(currentUnitName)) {
    values.manual_inputs.unit_full_name = {
      value_text: orgUnitName
    };
  }

  const existingBudgetExplanationText = values.manual_inputs.budget_explanation?.value_text
    ? String(values.manual_inputs.budget_explanation.value_text)
    : '';
  const shouldAutoBuildBudgetExplanation = !existingBudgetExplanationText
    || shouldRegenerateBudgetExplanation(existingBudgetExplanationText);

  if (shouldAutoBuildBudgetExplanation) {
    const unitName = values.manual_inputs.unit_full_name?.value_text || orgUnitName || '';
    const currentValues = {
      budget_revenue_total: factsByKey.get('budget_revenue_total'),
      budget_revenue_fiscal: factsByKey.get('budget_revenue_fiscal'),
      budget_revenue_business: factsByKey.get('budget_revenue_business'),
      budget_revenue_operation: factsByKey.get('budget_revenue_operation'),
      budget_revenue_other: factsByKey.get('budget_revenue_other'),
      budget_expenditure_total: factsByKey.get('budget_expenditure_total'),
      fiscal_grant_expenditure_total: factsByKey.get('fiscal_grant_expenditure_total'),
      fiscal_grant_expenditure_general: factsByKey.get('fiscal_grant_expenditure_general'),
      fiscal_grant_expenditure_gov_fund: factsByKey.get('fiscal_grant_expenditure_gov_fund'),
      fiscal_grant_expenditure_capital: factsByKey.get('fiscal_grant_expenditure_capital')
    };

    const previousValues = await extractPreviousBudgetValues({
      unitId: payload.draft.unit_id,
      year: payload.draft.year
    });

    const previousChangeReason = await fetchPreviousChangeReason({
      unitId: payload.draft.unit_id,
      year: payload.draft.year
    });

    const budgetExplanation = buildBudgetExplanationText({
      unitName,
      year: payload.draft.year,
      current: currentValues,
      previous: previousValues,
      changeReason: previousChangeReason || ''
    });

    if (budgetExplanation) {
      values.manual_inputs.budget_explanation = { value_text: budgetExplanation };
    }
  }

  return {
    draft: payload.draft,
    values,
    uploadFilePath: payload.uploadFilePath
  };
};

module.exports = {
  buildFinalValues
};
