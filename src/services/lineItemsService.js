const db = require('../db');

const DEFAULT_REASON_THRESHOLD = 0.1;
const PAGE_MARKER_REGEX = /--\s*\d+\s*of\s*\d+\s*--/g;

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

const normalizeLine = (line) => line.replace(/\s+/g, ' ').trim();
const normalizeForMatch = (value) => String(value || '')
  .replace(/[\s，。,:：；;（）()【】[\]、]/g, '')
  .trim();
const normalizeName = (value) => normalizeForMatch(value).replace(/[0-9.,万元%]/g, '');

const toWanyuan = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Number((parsed / 10000).toFixed(2));
};

const formatWanyuan = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0.00';
  return parsed.toFixed(2);
};

const extractReasonSnippet = (text) => {
  if (!text) return '';
  const trimmed = String(text).trim();
  if (!trimmed) return '';

  const markers = ['主要原因是', '主要原因', '主要用于', '主要'];
  for (const marker of markers) {
    const idx = trimmed.indexOf(marker);
    if (idx !== -1) {
      const rest = trimmed.slice(idx + marker.length).replace(/^[:：\s]+/, '');
      return rest.replace(/[。.]$/g, '').trim();
    }
  }

  const lastComma = Math.max(trimmed.lastIndexOf('，'), trimmed.lastIndexOf(','));
  if (lastComma !== -1 && lastComma < trimmed.length - 1) {
    return trimmed.slice(lastComma + 1).replace(/[。.]$/g, '').trim();
  }

  return trimmed.replace(/[。.]$/g, '').trim();
};

const buildLineItemLabel = ({ itemName, className, typeName }) => {
  if (!itemName) return '';
  const parts = [];
  if (className) parts.push(`${className}（类）`);
  if (typeName) parts.push(`${typeName}（款）`);
  parts.push(`${itemName}（项）`);
  return parts.join('');
};

const buildDefaultReasonText = ({ label, currentWanyuan, prevWanyuan, reasonSnippet }) => {
  const currentText = formatWanyuan(currentWanyuan ?? 0);
  const prevText = formatWanyuan(prevWanyuan ?? 0);
  let reason = (reasonSnippet || '').trim();
  reason = reason.replace(/^主要(原因是)?[:：]?\s*/, '').trim();
  if (!reason) reason = '原因待补充';
  return `“${label}”${currentText}万元，上年:${prevText}万元，主要${reason}。`;
};

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
    const reasonText = item.reason_text && item.reason_text.trim()
      ? item.reason_text.trim()
      : '';
    if (reasonText && reasonText.includes('万元')) {
      return reasonText;
    }
    const amountText = item.amount_current_wanyuan === null || item.amount_current_wanyuan === undefined
      ? '金额待补充'
      : `${Number(item.amount_current_wanyuan).toFixed(2)}万元`;
    const fallbackReason = reasonText || '未填写原因';
    return `${item.item_label}${amountText}，${fallbackReason}`;
  }).join('；');
};

const looksLikeSectionHeading = (line) => {
  const trimmed = normalizeLine(line);
  if (!trimmed) return false;
  const keywords = [
    '国有资产',
    '名词解释',
    '其他相关情况说明',
    '单位基本情况',
    '预算汇总情况',
    '财政拨款收支情况',
    '预算编制说明',
    '政府采购',
    '绩效目标'
  ];
  if (keywords.some((keyword) => trimmed.includes(keyword))) {
    return true;
  }
  return trimmed.length <= 10 && /^[一二三四五六七八九十]+、/.test(trimmed);
};

const extractLineItemReasonLines = (text) => {
  if (!text) return [];
  const cleaned = text.replace(PAGE_MARKER_REGEX, '');
  const lines = cleaned.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const startIndex = lines.findIndex((line) => line.includes('财政拨款支出主要内容'));
  if (startIndex === -1) return [];

  const result = [];
  const headerLine = lines[startIndex];
  const headerParts = headerLine.split(/：|:/);
  if (headerParts.length > 1) {
    const remainder = headerParts.slice(1).join('：').trim();
    if (remainder) result.push(remainder);
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (looksLikeSectionHeading(line)) break;
    result.push(line);
  }

  return result;
};

const matchReasonLinesToItems = (lines, items) => {
  const matched = new Map();
  if (!lines || lines.length === 0 || !items || items.length === 0) {
    return matched;
  }

  const normalizedLines = lines.map((line) => {
    const withoutAmounts = line.replace(/[-+]?[\d.,]+\s*万元/g, '');
    return {
      line,
      normalized: normalizeName(withoutAmounts)
    };
  });

  items.forEach((item) => {
    const name = item.name || '';
    const code = item.code || '';
    const normalizedName = normalizeName(name);
    let bestLine = null;
    let bestScore = 0;

    normalizedLines.forEach((candidate) => {
      if (!candidate.normalized) return;
      const hasCode = code && candidate.line.includes(code);
      const nameMatch = normalizedName
        && (candidate.normalized.includes(normalizedName) || normalizedName.includes(candidate.normalized));
      if (!hasCode && !nameMatch) return;

      const score = candidate.line.length;
      if (score > bestScore) {
        bestScore = score;
        bestLine = candidate.line;
      }
    });

    if (bestLine) {
      matched.set(item.item_key, bestLine);
    }
  });

  return matched;
};

const fetchPreviousLineItemReasons = async ({ unitId, year }) => {
  if (!unitId || !year) return new Map();
  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) return new Map();

  const result = await db.query(
    `SELECT li.item_key, li.reason_text
     FROM line_items_reason li
     JOIN report_draft d ON d.id = li.draft_id
     WHERE d.unit_id = $1 AND d.year = $2
       AND li.reason_text IS NOT NULL AND li.reason_text <> ''`,
    [unitId, prevYear]
  );

  return new Map(result.rows.map((row) => [row.item_key, row.reason_text]));
};

const fetchPreviousReasonsFromPdf = async ({ departmentId, year, items }) => {
  if (!departmentId || !year || !items || items.length === 0) {
    return new Map();
  }

  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) return new Map();

  // Prefer the structured EXPLANATION_FISCAL_DETAIL sub-section (more precise)
  const fiscalDetailResult = await db.query(
    `SELECT content_text
     FROM org_dept_text_content
     WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET' AND category = 'EXPLANATION_FISCAL_DETAIL'`,
    [departmentId, prevYear]
  );

  // Fall back to the full EXPLANATION section
  const explanationResult = fiscalDetailResult.rowCount === 0
    ? await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET' AND category = 'EXPLANATION'`,
      [departmentId, prevYear]
    )
    : { rowCount: 0, rows: [] };

  // Last resort: RAW text
  const rawResult = fiscalDetailResult.rowCount === 0 && explanationResult.rowCount === 0
    ? await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET' AND category = 'RAW'`,
      [departmentId, prevYear]
    )
    : { rowCount: 0, rows: [] };

  const sourceText = fiscalDetailResult.rows[0]?.content_text
    || explanationResult.rows[0]?.content_text
    || rawResult.rows[0]?.content_text;
  if (!sourceText) return new Map();

  const lines = extractLineItemReasonLines(sourceText);
  return matchReasonLinesToItems(lines, items);
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

const getLineItems = async ({ draftId, uploadId, threshold, unitId, year }) => {
  const resolvedThreshold = threshold === undefined || threshold === null
    ? DEFAULT_REASON_THRESHOLD
    : resolveReasonThreshold(threshold);

  let departmentId = null;
  if (unitId) {
    const deptResult = await db.query(
      `SELECT department_id
       FROM org_unit
       WHERE id = $1`,
      [unitId]
    );
    departmentId = deptResult.rows[0]?.department_id || null;
  }

  const inputsResult = await db.query(
    `SELECT key, value_text
     FROM manual_inputs
     WHERE draft_id = $1
       AND (key LIKE 'name_line_item_%'
         OR key LIKE 'name_class_%'
         OR key LIKE 'name_type_%')`,
    [draftId]
  );

  const classNameMap = new Map();
  const typeNameMap = new Map();
  const lineItemRows = [];

  inputsResult.rows.forEach((row) => {
    if (row.key.startsWith('name_class_')) {
      const code = row.key.replace('name_class_', '');
      classNameMap.set(code, row.value_text);
    } else if (row.key.startsWith('name_type_')) {
      const code = row.key.replace('name_type_', '');
      typeNameMap.set(code, row.value_text);
    } else if (row.key.startsWith('name_line_item_')) {
      lineItemRows.push(row);
    }
  });

  const prevLineItemMap = new Map();
  const prevClassNameMap = new Map();
  const prevTypeNameMap = new Map();

  if (departmentId && year) {
    const prevYear = Number(year) - 1;
    if (Number.isInteger(prevYear) && prevYear > 0) {
      const prevItemsResult = await db.query(
        `SELECT class_code, type_code, item_code, item_name, values_json
         FROM org_dept_line_items
         WHERE department_id = $1 AND year = $2
           AND report_type = 'BUDGET'
           AND table_key = ANY($3)`,
        [departmentId, prevYear, ['general_budget', 'gov_fund_budget', 'capital_budget']]
      );

      prevItemsResult.rows.forEach((row) => {
        const classCode = row.class_code ? String(row.class_code).trim() : '';
        const typeCode = row.type_code ? String(row.type_code).trim() : '';
        const itemCode = row.item_code ? String(row.item_code).trim() : '';
        const name = row.item_name ? String(row.item_name).trim() : '';
        let values = row.values_json || {};
        if (typeof values === 'string') {
          try {
            values = JSON.parse(values);
          } catch (error) {
            values = {};
          }
        }

        if (classCode && !typeCode && !itemCode && name && !prevClassNameMap.has(classCode)) {
          prevClassNameMap.set(classCode, name);
          return;
        }

        if (classCode && typeCode && !itemCode && name && !prevTypeNameMap.has(`${classCode}${typeCode}`)) {
          prevTypeNameMap.set(`${classCode}${typeCode}`, name);
          return;
        }

        if (!itemCode) return;

        const code = `${classCode}${typeCode}${itemCode}`;
        if (!/^\d+$/.test(code)) return;

        const total = values.total ?? null;
        const basic = values.basic ?? 0;
        const project = values.project ?? 0;
        const totalValue = Number(total);
        const amount = Number.isFinite(totalValue)
          ? totalValue
          : Number(basic) + Number(project);

        if (Number.isFinite(amount)) {
          prevLineItemMap.set(code, amount);
        }
      });
    }
  }

  const dynamicItems = lineItemRows.map((row) => {
    const code = row.key.replace('name_line_item_', '');
    const classCode = code.slice(0, 3);
    const typeCode = code.length >= 5 ? code.slice(0, 5) : '';
    const itemName = row.value_text;
    const className = classNameMap.get(classCode) || prevClassNameMap.get(classCode) || '';
    const typeName = typeCode
      ? (typeNameMap.get(typeCode) || prevTypeNameMap.get(typeCode) || '')
      : '';
    return {
      code,
      name: itemName,
      label: buildLineItemLabel({ itemName, className, typeName }),
      item_key: `line_item_${code}`
    };
  }).filter((item) => item.code.length >= 7);

  const factKeys = dynamicItems.map((item) => `amount_${item.item_key}`);

  if (factKeys.length === 0) {
    return [];
  }

  const factsResult = await db.query(
    `SELECT key, value_numeric
     FROM facts_budget
     WHERE upload_id = $1
       AND key = ANY($2)`,
    [uploadId, factKeys]
  );

  const factsMap = new Map(
    factsResult.rows.map((row) => [row.key, Number(row.value_numeric)])
  );

  let prevFactsMap = new Map();
  if (unitId && year) {
    const prevYear = Number(year) - 1;
    if (Number.isInteger(prevYear) && prevYear > 0) {
      const prevFactsResult = await db.query(
        `SELECT key, value_numeric
         FROM facts_budget
         WHERE unit_id = $1 AND year = $2 AND key = ANY($3)`,
        [unitId, prevYear, factKeys]
      );
      prevFactsMap = new Map(
        prevFactsResult.rows.map((row) => [row.key, Number(row.value_numeric)])
      );
    }
  }

  const reasonsResult = await db.query(
    `SELECT item_key, reason_text, order_no
     FROM line_items_reason
     WHERE draft_id = $1`,
    [draftId]
  );

  const reasonMap = new Map(
    reasonsResult.rows.map((row) => [row.item_key, row])
  );

  let previousReasonMap = new Map();
  if (unitId && year) {
    previousReasonMap = await fetchPreviousLineItemReasons({ unitId, year });
    const pdfReasonMap = await fetchPreviousReasonsFromPdf({
      departmentId,
      year,
      items: dynamicItems
    });

    for (const [itemKey, reasonText] of pdfReasonMap.entries()) {
      if (!previousReasonMap.has(itemKey)) {
        previousReasonMap.set(itemKey, reasonText);
      }
    }
  }

  const items = dynamicItems.map((item, index) => {
    const amountKey = `amount_${item.item_key}`;
    const currentValue = factsMap.get(amountKey) || 0;
    const currentWanyuan = toWanyuan(currentValue) ?? 0;

    const prevValue = prevFactsMap.get(amountKey) ?? prevLineItemMap.get(item.code) ?? null;
    const prevWanyuan = toWanyuan(prevValue);
    const reasonRequired = isReasonRequired(currentWanyuan, prevWanyuan, resolvedThreshold);

    const storedReason = reasonMap.get(item.item_key);
    const previousReasonText = previousReasonMap.get(item.item_key) || '';
    const previousReasonSnippet = extractReasonSnippet(previousReasonText);
    const defaultText = buildDefaultReasonText({
      label: item.label || item.name || item.code,
      currentWanyuan,
      prevWanyuan,
      reasonSnippet: previousReasonSnippet
    });
    const storedText = storedReason?.reason_text && storedReason.reason_text.trim()
      ? storedReason.reason_text.trim()
      : null;

    return {
      item_key: item.item_key,
      item_label: item.label || `${item.name} (${item.code})`,
      amount_current_wanyuan: currentWanyuan,
      amount_prev_wanyuan: prevWanyuan,
      change_ratio: 0,
      reason_text: storedText ?? defaultText,
      previous_reason_text: previousReasonSnippet || previousReasonText,
      reason_required: reasonRequired,
      order_no: index
    };
  });

  return items;
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
