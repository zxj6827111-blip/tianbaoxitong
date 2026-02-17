const db = require('../db');
const { getRequiredHistoryActualKeys } = require('./historyActualsConfig');

const DEFAULT_TOLERANCE = 0.01;

const toNumeric = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getEffectiveFieldValue = (field) => {
  const corrected = toNumeric(field?.corrected_value);
  if (corrected !== null) return corrected;
  return toNumeric(field?.normalized_value);
};

const buildFieldValueMap = (fields) => {
  const map = new Map();
  for (const field of fields || []) {
    const value = getEffectiveFieldValue(field);
    map.set(field.key, value);
  }
  return map;
};

const addIssue = (issues, issue) => {
  issues.push({
    rule_id: issue.rule_id,
    level: issue.level,
    message: issue.message,
    evidence: issue.evidence || null
  });
};

const validateArithmetic = (issues, valueMap, tolerance = DEFAULT_TOLERANCE) => {
  const revenue = valueMap.get('budget_revenue_total');
  const expenditure = valueMap.get('budget_expenditure_total');
  if (revenue !== null && expenditure !== null) {
    const diff = Math.abs(revenue - expenditure);
    if (diff > tolerance) {
      addIssue(issues, {
        rule_id: 'ARCHIVE.BALANCE_REVENUE_EXPENDITURE',
        level: 'ERROR',
        message: '收入预算合计与支出预算合计不一致',
        evidence: {
          budget_revenue_total: revenue,
          budget_expenditure_total: expenditure,
          diff
        }
      });
    }
  }

  const basic = valueMap.get('budget_expenditure_basic');
  const project = valueMap.get('budget_expenditure_project');
  if (expenditure !== null && basic !== null && project !== null) {
    const sum = basic + project;
    const diff = Math.abs(expenditure - sum);
    if (diff > tolerance) {
      addIssue(issues, {
        rule_id: 'ARCHIVE.BALANCE_EXPENDITURE_COMPONENTS',
        level: 'ERROR',
        message: '支出预算合计不等于基本支出与项目支出之和',
        evidence: {
          budget_expenditure_total: expenditure,
          budget_expenditure_basic: basic,
          budget_expenditure_project: project,
          components_sum: sum,
          diff
        }
      });
    }
  }

  const fiscalRevenue = valueMap.get('fiscal_grant_revenue_total');
  const fiscalExpenditure = valueMap.get('fiscal_grant_expenditure_total');
  if (fiscalRevenue !== null && fiscalExpenditure !== null) {
    const diff = Math.abs(fiscalRevenue - fiscalExpenditure);
    if (diff > tolerance) {
      addIssue(issues, {
        rule_id: 'ARCHIVE.BALANCE_FISCAL_GRANT',
        level: 'ERROR',
        message: '财政拨款收入合计与财政拨款支出合计不一致',
        evidence: {
          fiscal_grant_revenue_total: fiscalRevenue,
          fiscal_grant_expenditure_total: fiscalExpenditure,
          diff
        }
      });
    }
  }
};

const validateRequiredCoverage = (issues, valueMap) => {
  const missingKeys = getRequiredHistoryActualKeys().filter((key) => valueMap.get(key) === null);
  if (missingKeys.length > 0) {
    addIssue(issues, {
      rule_id: 'ARCHIVE.FIELD_COVERAGE',
      level: 'ERROR',
      message: `必填字段缺失：${missingKeys.join(', ')}`,
      evidence: { missing_keys: missingKeys }
    });
  }
};

const validateYoYAnomaly = async ({ issues, unitId, year, valueMap }) => {
  const prevYear = Number(year) - 1;
  if (!unitId || !Number.isInteger(prevYear) || prevYear < 1900) return;

  const keys = Array.from(valueMap.keys());
  if (keys.length === 0) return;

  const result = await db.query(
    `SELECT key, value_numeric
     FROM history_actuals
     WHERE unit_id = $1
       AND year = $2
       AND stage = 'FINAL'
       AND key = ANY($3)`,
    [unitId, prevYear, keys]
  );
  const prevMap = new Map(result.rows.map((row) => [row.key, toNumeric(row.value_numeric)]));

  for (const key of keys) {
    const current = valueMap.get(key);
    const previous = prevMap.get(key);
    if (current === null || previous === null || previous === 0) continue;
    const ratio = Math.abs((current - previous) / previous);
    if (ratio > 0.5) {
      addIssue(issues, {
        rule_id: 'ARCHIVE.YOY_ANOMALY',
        level: 'WARN',
        message: `${key} 与上一年度偏差超过 50%`,
        evidence: {
          key,
          current,
          previous,
          ratio: Number(ratio.toFixed(4)),
          prev_year: prevYear
        }
      });
    }
  }
};

const runArchivePreviewValidation = async ({ unitId, year, fields }) => {
  const issues = [];
  const valueMap = buildFieldValueMap(fields);

  validateRequiredCoverage(issues, valueMap);
  validateArithmetic(issues, valueMap);
  await validateYoYAnomaly({ issues, unitId, year, valueMap });

  return issues;
};

module.exports = {
  runArchivePreviewValidation,
  getEffectiveFieldValue
};
