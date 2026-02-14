const TOKENS = {
  unit: '\u5355\u4f4d',
  yuan: '\u5143',
  qianyuan: '\u5343\u5143',
  wanyuan: '\u4e07\u5143',
  thisYearRevenue: '\u672c\u5e74\u6536\u5165',
  thisYearExpenditure: '\u672c\u5e74\u652f\u51fa',
  revenueTotal: '\u6536\u5165\u603b\u8ba1',
  expenditureTotal: '\u652f\u51fa\u603b\u8ba1',
  fiscalRevenue: '\u8d22\u653f\u62e8\u6b3e\u6536\u5165',
  businessRevenue: '\u4e8b\u4e1a\u6536\u5165',
  operationRevenue: '\u4e8b\u4e1a\u5355\u4f4d\u7ecf\u8425\u6536\u5165',
  otherRevenue: '\u5176\u4ed6\u6536\u5165',
  fiscalExpenditure: '\u8d22\u653f\u62e8\u6b3e\u652f\u51fa',
  threePublic: '\u4e09\u516c',
  outbound: '\u56e0\u516c\u51fa\u56fd',
  reception: '\u516c\u52a1\u63a5\u5f85\u8d39',
  vehicle: '\u516c\u52a1\u7528\u8f66'
};

const TABLE_DEFAULT_UNIT = {
  budget_summary: 'yuan',
  income_summary: 'yuan',
  expenditure_summary: 'yuan',
  fiscal_grant_summary: 'yuan',
  general_budget: 'yuan',
  gov_fund_budget: 'yuan',
  capital_budget: 'yuan',
  basic_expenditure: 'yuan',
  three_public: 'wanyuan'
};

const UNIT_TO_SCALE_WANYUAN = {
  yuan: 1 / 10000,
  qianyuan: 0.1,
  wanyuan: 1
};

const parseNumber = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!raw || raw === '-') return null;

  const negativeByParen = /^\((.+)\)$/.exec(raw);
  const normalized = negativeByParen ? `-${negativeByParen[1]}` : raw;

  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const compactText = (value) => String(value || '').replace(/[\s\u3000]+/g, '').trim();

const rowToText = (row) => {
  if (!Array.isArray(row)) return '';
  return row.map((cell) => compactText(cell)).join('');
};

const rowsToText = (rows, maxRows = 12) => {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, maxRows)
    .flat()
    .map((cell) => compactText(cell))
    .join('');
};

const detectDeclaredUnit = (rows, maxRows = 20) => {
  const sourceRows = (Array.isArray(rows) ? rows : []).slice(0, maxRows);
  const candidates = [];

  for (const row of sourceRows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const text = String(cell || '').replace(/\s+/g, '');
      if (!text || !text.includes(TOKENS.unit)) continue;
      candidates.push(text);
    }
  }

  if (candidates.length === 0) return null;
  const merged = candidates.join('|');

  if (merged.includes(TOKENS.wanyuan)) return 'wanyuan';
  if (merged.includes(TOKENS.qianyuan)) return 'qianyuan';
  if (merged.includes(`${TOKENS.unit}:${TOKENS.yuan}`) || merged.includes(`${TOKENS.unit}：${TOKENS.yuan}`)) {
    return 'yuan';
  }
  if (merged.includes(TOKENS.yuan) && !merged.includes(TOKENS.wanyuan) && !merged.includes(TOKENS.qianyuan)) {
    return 'yuan';
  }
  return null;
};

const inferScaleToWanyuan = (rows, options = {}) => {
  const values = [];
  const sourceRows = Array.isArray(rows) ? rows.slice(0, 80) : [];

  for (const row of sourceRows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const parsed = parseNumber(cell);
      if (parsed !== null) values.push(Math.abs(parsed));
    }
  }

  if (values.length === 0) return options.defaultScale ?? 1;
  const maxAbs = Math.max(...values);

  // If no unit was detected, very large integers are almost always "元".
  if (maxAbs >= 100000) return 1 / 10000;
  return options.defaultScale ?? 1;
};

const detectScaleToWanyuan = (rows, options = {}) => {
  const declaredUnit = detectDeclaredUnit(rows, 20);
  if (declaredUnit && UNIT_TO_SCALE_WANYUAN[declaredUnit] !== undefined) {
    return UNIT_TO_SCALE_WANYUAN[declaredUnit];
  }

  const defaultUnit = TABLE_DEFAULT_UNIT[options.tableKey];
  if (defaultUnit && UNIT_TO_SCALE_WANYUAN[defaultUnit] !== undefined) {
    return UNIT_TO_SCALE_WANYUAN[defaultUnit];
  }

  const unitText = rowsToText(rows, 12);
  if (!unitText) return options.defaultScale ?? 1;

  if (unitText.includes(TOKENS.wanyuan)) return 1;
  if (unitText.includes(TOKENS.qianyuan)) return 0.1;

  const explicitUnitYuan = unitText.includes(`${TOKENS.unit}:${TOKENS.yuan}`)
    || unitText.includes(`${TOKENS.unit}：${TOKENS.yuan}`);
  if (explicitUnitYuan) return 1 / 10000;

  const mentionsOnlyYuan = unitText.includes(TOKENS.yuan)
    && !unitText.includes(TOKENS.wanyuan)
    && !unitText.includes(TOKENS.qianyuan);
  if (mentionsOnlyYuan) return 1 / 10000;

  return inferScaleToWanyuan(rows, options);
};

const findRow = (rows, includeTokens, excludeTokens = []) => {
  const include = Array.isArray(includeTokens) ? includeTokens : [includeTokens];
  const exclude = Array.isArray(excludeTokens) ? excludeTokens : [excludeTokens];
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const text = rowToText(row);
    if (!text) return false;
    const okInclude = include.every((token) => text.includes(token));
    const okExclude = exclude.every((token) => !text.includes(token));
    return okInclude && okExclude;
  }) || null;
};

const readValue = (row, index, scale, fallbackZero = false) => {
  if (!row) return null;
  const parsed = parseNumber(row[index]);
  if (parsed === null) return fallbackZero ? 0 : null;
  return parsed * scale;
};

const isTopLevelCategoryRow = (row) => {
  if (!Array.isArray(row) || row.length < 4) return false;
  const first = compactText(row[0]);
  const second = compactText(row[1]);
  if (!/^\d{3}$/.test(first)) return false;
  if (!second) return false;
  if (/^\d+$/.test(second)) return false;
  return true;
};

const sumByIndex = (rows, index, scale) => {
  return rows.reduce((sum, row) => {
    const parsed = parseNumber(row[index]);
    return parsed === null ? sum : sum + parsed * scale;
  }, 0);
};

const extractFromBudgetSummary = (rows) => {
  const scale = detectScaleToWanyuan(rows, { defaultScale: 1, tableKey: 'budget_summary' });
  const result = {};

  const revenueTotalRow = findRow(rows, TOKENS.revenueTotal);
  const expenditureTotalRow = findRow(rows, TOKENS.expenditureTotal);
  const fiscalRow = findRow(rows, TOKENS.fiscalRevenue);
  const businessRow = findRow(rows, [TOKENS.businessRevenue], [TOKENS.operationRevenue]);
  const operationRow = findRow(rows, TOKENS.operationRevenue);
  const otherRow = findRow(rows, TOKENS.otherRevenue);

  result.budget_revenue_total = readValue(revenueTotalRow, 1, scale);
  result.budget_revenue_fiscal = readValue(fiscalRow, 1, scale, true);
  result.budget_revenue_business = readValue(businessRow, 1, scale, true);
  result.budget_revenue_operation = readValue(operationRow, 1, scale, true);
  result.budget_revenue_other = readValue(otherRow, 1, scale, true);
  result.budget_expenditure_total = readValue(expenditureTotalRow, 3, scale);

  return result;
};

const extractFromIncomeSummary = (rows) => {
  const scale = detectScaleToWanyuan(rows, { defaultScale: 1, tableKey: 'income_summary' });
  const dataRows = rows.filter(isTopLevelCategoryRow);
  if (dataRows.length === 0) return {};

  return {
    budget_revenue_total: sumByIndex(dataRows, 2, scale),
    budget_revenue_fiscal: sumByIndex(dataRows, 3, scale),
    budget_revenue_business: sumByIndex(dataRows, 4, scale),
    budget_revenue_operation: sumByIndex(dataRows, 5, scale),
    budget_revenue_other: sumByIndex(dataRows, 6, scale)
  };
};

const extractFromExpenditureSummary = (rows) => {
  const scale = detectScaleToWanyuan(rows, { defaultScale: 1, tableKey: 'expenditure_summary' });
  const dataRows = rows.filter(isTopLevelCategoryRow);
  if (dataRows.length === 0) return {};

  return {
    budget_expenditure_total: sumByIndex(dataRows, 2, scale),
    budget_expenditure_basic: sumByIndex(dataRows, 3, scale),
    budget_expenditure_project: sumByIndex(dataRows, 4, scale)
  };
};

const extractFromFiscalGrantSummary = (rows) => {
  const scale = detectScaleToWanyuan(rows, { defaultScale: 1, tableKey: 'fiscal_grant_summary' });
  const result = {};
  const totalRow = findRow(rows, TOKENS.expenditureTotal) || findRow(rows, TOKENS.revenueTotal);

  result.fiscal_grant_revenue_total = readValue(totalRow, 1, scale);
  result.fiscal_grant_expenditure_total = readValue(totalRow, 3, scale);
  result.fiscal_grant_expenditure_general = readValue(totalRow, 4, scale, true);
  result.fiscal_grant_expenditure_gov_fund = readValue(totalRow, 5, scale, true);
  result.fiscal_grant_expenditure_capital = readValue(totalRow, 6, scale, true);

  return result;
};

const extractFromThreePublic = (rows) => {
  const scale = detectScaleToWanyuan(rows, { defaultScale: 1, tableKey: 'three_public' });
  const tableText = rowsToText(rows, 20);
  const hasOperationFund = tableText.includes('\u673a\u5173\u8fd0\u884c\u7ecf\u8d39');
  const hasOutboundLabel = tableText.includes('\u56e0\u516c\u51fa\u56fd') || tableText.includes('\u56e0\u516c\u51fa\u56fd(\u5883)');
  const hasReceptionLabel = tableText.includes('\u516c\u52a1\u63a5\u5f85\u8d39');
  const hasVehicleSubHeaders = tableText.includes('\u5c0f\u8ba1')
    || tableText.includes('\u8d2d\u7f6e\u8d39')
    || tableText.includes('\u8fd0\u884c\u8d39');

  const dataRow = [...rows]
    .reverse()
    .find((row) => Array.isArray(row) && row.filter((cell) => parseNumber(cell) !== null).length >= 2);

  if (!dataRow) return {};

  const nums = dataRow
    .map((cell) => parseNumber(cell))
    .filter((n) => n !== null)
    .map((n) => n * scale);
  if (nums.length < 2) return {};

  const result = {
    three_public_total: nums[0] ?? null,
    three_public_outbound: null,
    three_public_reception: null,
    three_public_vehicle_total: null,
    three_public_vehicle_purchase: null,
    three_public_vehicle_operation: null,
    operation_fund: null
  };

  // Standard layout: [total, outbound, reception, vehicle_total, vehicle_purchase, vehicle_operation, operation_fund]
  if (nums.length >= 7) {
    result.three_public_outbound = nums[1] ?? null;
    result.three_public_reception = nums[2] ?? null;
    result.three_public_vehicle_total = nums[3] ?? null;
    result.three_public_vehicle_purchase = nums[4] ?? null;
    result.three_public_vehicle_operation = nums[5] ?? null;
    result.operation_fund = nums[6] ?? null;
    return result;
  }

  if (nums.length >= 6) {
    result.three_public_outbound = nums[1] ?? null;
    result.three_public_reception = nums[2] ?? null;
    result.three_public_vehicle_total = nums[3] ?? null;
    result.three_public_vehicle_purchase = nums[4] ?? null;
    result.three_public_vehicle_operation = nums[5] ?? null;
    return result;
  }

  // Sparse OCR layout (common): [three_public_total, three_public_reception, operation_fund]
  if (nums.length === 3) {
    result.three_public_total = nums[0] ?? null;
    if (hasOutboundLabel && hasReceptionLabel) {
      result.three_public_reception = nums[1] ?? null;
      result.three_public_outbound = 0;
    } else if (hasReceptionLabel) {
      result.three_public_reception = nums[1] ?? null;
    } else if (hasOutboundLabel) {
      result.three_public_outbound = nums[1] ?? null;
    }
    const likelyOperationFundByMagnitude = Number.isFinite(nums[2])
      && Number.isFinite(nums[0])
      && Number.isFinite(nums[1])
      && Math.abs(nums[2]) > Math.max(Math.abs(nums[0]), Math.abs(nums[1])) * 5;
    if (hasOperationFund || (hasVehicleSubHeaders && likelyOperationFundByMagnitude)) {
      result.operation_fund = nums[2] ?? null;
    }
    return result;
  }

  if (nums.length === 2) {
    result.three_public_total = nums[0] ?? null;
    if (hasOperationFund) {
      result.operation_fund = nums[1] ?? null;
    } else if (hasReceptionLabel) {
      result.three_public_reception = nums[1] ?? null;
    } else if (hasOutboundLabel) {
      result.three_public_outbound = nums[1] ?? null;
    }
    return result;
  }

  return result;
};

const resolveTableRows = ({
  tableRows,
  tableMap,
  key,
  markers,
  requiredMarkers = [],
  minScore = 2
}) => {
  const byKey = tableMap.get(key);
  if (Array.isArray(byKey) && byKey.length > 0) return byKey;

  let bestRows = [];
  let bestScore = 0;
  for (const row of tableRows) {
    const rows = Array.isArray(row?.data_json) ? row.data_json : [];
    if (rows.length === 0) continue;
    const text = rowsToText(rows, 28);
    const hasRequired = requiredMarkers.every((marker) => text.includes(marker));
    if (!hasRequired) continue;
    const score = markers.reduce((sum, marker) => sum + (text.includes(marker) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }

  return bestScore >= minScore ? bestRows : [];
};

const mergeIfMissing = (target, patch) => {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return;
    if (target[key] === null || target[key] === undefined) {
      target[key] = value;
    }
  });
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(2));
};

const extractHistoryFactsFromTableData = (tableRowsInput) => {
  const tableRows = Array.isArray(tableRowsInput) ? tableRowsInput : [];
  const result = {};
  const tableMap = new Map(
    tableRows.map((row) => [row.table_key, Array.isArray(row.data_json) ? row.data_json : []])
  );

  const budgetSummaryRows = resolveTableRows({
    tableRows,
    tableMap,
    key: 'budget_summary',
    markers: [TOKENS.thisYearRevenue, TOKENS.thisYearExpenditure, TOKENS.revenueTotal, TOKENS.expenditureTotal]
  });
  const incomeSummaryRows = resolveTableRows({
    tableRows,
    tableMap,
    key: 'income_summary',
    markers: [TOKENS.thisYearRevenue, TOKENS.fiscalRevenue, TOKENS.otherRevenue]
  });
  const expenditureSummaryRows = resolveTableRows({
    tableRows,
    tableMap,
    key: 'expenditure_summary',
    markers: [TOKENS.thisYearExpenditure, TOKENS.expenditureTotal]
  });
  const fiscalGrantRows = resolveTableRows({
    tableRows,
    tableMap,
    key: 'fiscal_grant_summary',
    markers: [TOKENS.fiscalRevenue, TOKENS.fiscalExpenditure, TOKENS.expenditureTotal]
  });
  const threePublicRows = resolveTableRows({
    tableRows,
    tableMap,
    key: 'three_public',
    markers: [TOKENS.threePublic, TOKENS.outbound, TOKENS.reception, TOKENS.vehicle],
    requiredMarkers: [TOKENS.outbound, TOKENS.reception],
    minScore: 2
  });

  mergeIfMissing(result, extractFromBudgetSummary(budgetSummaryRows));
  mergeIfMissing(result, extractFromIncomeSummary(incomeSummaryRows));
  mergeIfMissing(result, extractFromExpenditureSummary(expenditureSummaryRows));
  mergeIfMissing(result, extractFromFiscalGrantSummary(fiscalGrantRows));
  mergeIfMissing(result, extractFromThreePublic(threePublicRows));

  const normalized = {};
  Object.entries(result).forEach(([key, value]) => {
    const fixed = normalizeNumber(value);
    if (fixed !== null) normalized[key] = fixed;
  });

  if (normalized.budget_revenue_total === null || normalized.budget_revenue_total === undefined) {
    const revenueParts = ['budget_revenue_fiscal', 'budget_revenue_business', 'budget_revenue_operation', 'budget_revenue_other']
      .map((k) => normalized[k])
      .filter((v) => Number.isFinite(v));
    if (revenueParts.length > 0) {
      normalized.budget_revenue_total = normalizeNumber(revenueParts.reduce((a, b) => a + b, 0));
    }
  }

  if (normalized.fiscal_grant_revenue_total === null || normalized.fiscal_grant_revenue_total === undefined) {
    if (Number.isFinite(normalized.budget_revenue_fiscal)) {
      normalized.fiscal_grant_revenue_total = normalized.budget_revenue_fiscal;
    }
  }

  if (normalized.fiscal_grant_expenditure_total === null || normalized.fiscal_grant_expenditure_total === undefined) {
    if (Number.isFinite(normalized.budget_expenditure_total)) {
      normalized.fiscal_grant_expenditure_total = normalized.budget_expenditure_total;
    }
  }

  if (normalized.fiscal_grant_expenditure_general === null || normalized.fiscal_grant_expenditure_general === undefined) {
    if (Number.isFinite(normalized.fiscal_grant_expenditure_total)) {
      normalized.fiscal_grant_expenditure_general = normalized.fiscal_grant_expenditure_total;
    }
  }

  return normalized;
};

module.exports = {
  extractHistoryFactsFromTableData
};
