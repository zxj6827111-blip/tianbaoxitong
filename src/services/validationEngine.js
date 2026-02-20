const db = require('../db');
const { AppError } = require('../errors');
const { getLineItems, resolveReasonThreshold } = require('./lineItemsService');

const DEFAULT_TOLERANCE = 0.01;

const REQUIRED_MANUAL_KEYS = [
  { key: 'main_functions', label: '主要职能' },
  { key: 'organizational_structure', label: '机构设置' },
  { key: 'glossary', label: '名词解释' },
  { key: 'budget_change_reason', label: '预算增减主要原因' },
  { key: 'state_owned_assets', label: '国有资产占有使用情况' },
  { key: 'project_overview', label: '项目概述' },
  { key: 'project_basis', label: '立项依据' },
  { key: 'project_subject', label: '实施主体' },
  { key: 'project_plan', label: '实施方案' },
  { key: 'project_cycle', label: '实施周期' },
  { key: 'project_budget_arrangement', label: '年度预算安排' },
  { key: 'project_performance_goal', label: '绩效目标' }
];

const PLACEHOLDER_PATTERN = /(XX|XXX|\u2026\u2026|\u5f85\u8865\u5145|\u5f85\u586b\u5199|TODO|TBD|\uFF38\uFF38)/i;
const QUALITY_CHECK_MANUAL_KEYS = [
  'budget_explanation',
  'budget_change_reason',
  'state_owned_assets',
  'other_notes',
  'main_functions',
  'organizational_structure',
  'project_overview',
  'project_basis',
  'project_subject',
  'project_plan',
  'project_cycle',
  'project_budget_arrangement',
  'project_performance_goal'
];

const isAdminLike = (user) => {
  const roles = user?.roles || [];
  return roles.includes('admin') || roles.includes('maintainer');
};

const ensureDraftAccess = (draft, user) => {
  if (!user) {
    return;
  }
  if (isAdminLike(user)) {
    return;
  }
  if (user.unit_id && draft.unit_id && String(user.unit_id) === String(draft.unit_id)) {
    return;
  }
  if (user.id && draft.created_by && String(user.id) === String(draft.created_by)) {
    return;
  }

  throw new AppError({
    statusCode: 403,
    code: 'FORBIDDEN',
    message: 'No permission to access this draft'
  });
};

const normalizeIssueLevel = (level) => (level === 'WARN' ? 'WARNING' : level);

const normalizeRequiredManualKeys = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return REQUIRED_MANUAL_KEYS;
  }

  const normalized = raw.map((item) => {
    if (typeof item === 'string') {
      return { key: item, label: item };
    }
    if (item && typeof item === 'object' && typeof item.key === 'string') {
      return {
        key: item.key,
        label: typeof item.label === 'string' ? item.label : item.key
      };
    }
    return null;
  }).filter(Boolean);

  return normalized.length > 0 ? normalized : REQUIRED_MANUAL_KEYS;
};

const isManualInputFilled = (input) => {
  if (!input) return false;
  if (input.value_text && String(input.value_text).trim() !== '') return true;
  if (input.value_numeric !== null && input.value_numeric !== undefined && !Number.isNaN(Number(input.value_numeric))) return true;
  if (input.value_json !== null && input.value_json !== undefined) {
    if (typeof input.value_json === 'string') {
      return input.value_json.trim() !== '';
    }
    if (Array.isArray(input.value_json)) {
      return input.value_json.length > 0;
    }
    if (typeof input.value_json === 'object') {
      return Object.keys(input.value_json).length > 0;
    }
    return true;
  }
  return false;
};

const extractNumberFromText = (text) => {
  if (!text) {
    return null;
  }
  const match = String(text).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const getNumericValue = (input) => {
  if (!input) {
    return null;
  }
  if (input.value_numeric !== null && input.value_numeric !== undefined) {
    return Number(input.value_numeric);
  }
  if (input.value_text) {
    return extractNumberFromText(input.value_text);
  }
  if (input.value_json && typeof input.value_json === 'number') {
    return Number(input.value_json);
  }
  return null;
};

const containsPlaceholderToken = (text) => {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return PLACEHOLDER_PATTERN.test(text);
};

const buildEvidence = ({ facts = [], anchor, extra = {} } = {}) => {
  const cells = [];
  for (const fact of facts) {
    const evidence = fact?.evidence;
    if (evidence?.cells && Array.isArray(evidence.cells)) {
      for (const cell of evidence.cells) {
        cells.push(cell);
      }
    }
  }

  return {
    ...extra,
    ...(cells.length > 0 ? { cells } : {}),
    anchor: anchor || facts.map((fact) => `facts_budget:${fact.key}`).join('|')
  };
};

const buildMissingKeyEvidence = (missingKeys) => ({
  anchor: `manual_inputs:${missingKeys.join(',')}`,
  missing_keys: missingKeys.map((key) => ({
    key,
    expected_source: 'manual_inputs'
  }))
});

const buildLineItemEvidence = (count, threshold) => ({
  anchor: 'line_items_reason',
  count,
  threshold
});

const buildMissingReasonEvidence = (draftId, itemKey, threshold) => ({
  anchor: `line_items_reason:${itemKey}`,
  draft_id: draftId,
  item_key: itemKey,
  threshold
});

const compareWithinTolerance = (left, right, tolerance = DEFAULT_TOLERANCE) => {
  if (left === null || right === null) {
    return false;
  }
  return Math.abs(left - right) <= tolerance;
};

const createIssue = ({ level, rule_id, message, tolerance = DEFAULT_TOLERANCE, evidence }) => ({
  level,
  rule_id,
  message,
  tolerance,
  evidence
});

const rules = [
  {
    rule_id: 'BUDGET.RZ001',
    level: 'FATAL',
    title: '收入总计与支出总计一致',
    description: '预算汇总收入总计与支出总计差额不超过0.01万元',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const revenue = ctx.factsByKey.get('budget_revenue_total');
      const expenditure = ctx.factsByKey.get('budget_expenditure_total');
      const left = revenue?.value;
      const right = expenditure?.value;

      if (left === null || right === null) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ001',
          message: '预算汇总缺少收入总计或支出总计',
          tolerance: config.tolerance,
          evidence: buildEvidence({ facts: [revenue, expenditure], anchor: 'budget_revenue_total|budget_expenditure_total' })
        })];
      }

      if (!compareWithinTolerance(left, right, config.tolerance)) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ001',
          message: `收入总计与支出总计差额${(left - right).toFixed(3)}万元，超过容差`,
          tolerance: config.tolerance,
          evidence: buildEvidence({ facts: [revenue, expenditure] })
        })];
      }

      return [];
    }
  },
  {
    rule_id: 'BUDGET.RZ002',
    level: 'FATAL',
    title: '财政拨款收入与支出一致',
    description: '财政拨款收支总表拨款收入与拨款支出差额不超过0.01万元',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const revenue = ctx.factsByKey.get('fiscal_grant_revenue_total');
      const expenditure = ctx.factsByKey.get('fiscal_grant_expenditure_total');
      const left = revenue?.value;
      const right = expenditure?.value;

      if (left === null || right === null) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ002',
          message: '财政拨款收支总表缺少拨款收入或拨款支出',
          tolerance: config.tolerance,
          evidence: buildEvidence({ facts: [revenue, expenditure], anchor: 'fiscal_grant_revenue_total|fiscal_grant_expenditure_total' })
        })];
      }

      if (!compareWithinTolerance(left, right, config.tolerance)) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ002',
          message: `财政拨款收入与支出差额${(left - right).toFixed(3)}万元，超过容差`,
          tolerance: config.tolerance,
          evidence: buildEvidence({ facts: [revenue, expenditure] })
        })];
      }

      return [];
    }
  },
  {
    rule_id: 'BUDGET.RZ003',
    level: 'FATAL',
    title: '收入合计等于明细之和',
    description: '预算汇总收入合计等于财政拨款收入、事业收入、其他收入之和',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const total = ctx.factsByKey.get('budget_revenue_total');
      const fiscal = ctx.factsByKey.get('budget_revenue_fiscal');
      const business = ctx.factsByKey.get('budget_revenue_business');
      const operation = ctx.factsByKey.get('budget_revenue_operation');
      const other = ctx.factsByKey.get('budget_revenue_other');

      const totalValue = total?.value;
      const sumValue = [fiscal, business, operation, other].reduce((sum, item) => sum + (item?.value ?? 0), 0);

      if (totalValue === null || totalValue === undefined) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ003',
          message: '预算汇总缺少收入合计',
          tolerance: config.tolerance,
          evidence: buildEvidence({ facts: [total, fiscal, business, operation, other], anchor: 'budget_revenue_total' })
        })];
      }

      if (!compareWithinTolerance(totalValue, sumValue, config.tolerance)) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ003',
          message: `收入合计与明细之和差额${(totalValue - sumValue).toFixed(3)}万元，超过容差`,
          tolerance: config.tolerance,
          evidence: buildEvidence({ facts: [total, fiscal, business, operation, other] })
        })];
      }

      return [];
    }
  },
  {
    rule_id: 'BUDGET.RZ004',
    level: 'FATAL',
    title: '模板必填项完整',
    description: '关键必填字段不能为空',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const requiredKeys = ctx.requiredManualKeys || REQUIRED_MANUAL_KEYS;
      const missingItems = requiredKeys.filter((item) => {
        const input = ctx.manualInputsByKey.get(item.key);
        return !isManualInputFilled(input);
      });
      const missingKeys = missingItems.map((item) => item.key);

      if (missingKeys.length > 0) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ004',
          message: `缺少必填字段：${missingItems.map((item) => item.label || item.key).join('、')}`,
          tolerance: config.tolerance,
          evidence: buildMissingKeyEvidence(missingKeys)
        })];
      }

      return [];
    }
  },
  {
    rule_id: 'BUDGET.RZ005',
    level: 'WARNING',
    title: '文本与数字一致性',
    description: '摘要文本中的数字应与预算汇总保持一致',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const summaryInput = ctx.manualInputsByKey.get('summary_revenue_text');
      const summaryValue = getNumericValue(summaryInput);
      const revenue = ctx.factsByKey.get('budget_revenue_total');
      const revenueValue = revenue?.value ?? null;

      if (summaryValue === null || revenueValue === null) {
        return [];
      }

      if (!compareWithinTolerance(summaryValue, revenueValue, config.tolerance)) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ005',
          message: `文本数字${summaryValue}与预算收入${revenueValue}不一致`,
          tolerance: config.tolerance,
          evidence: buildEvidence({
            facts: [revenue],
            anchor: 'summary_revenue_text',
            extra: summaryInput?.evidence ? { manual_evidence: summaryInput.evidence } : {}
          })
        })];
      }

      return [];
    }
  },
  {
    rule_id: 'BUDGET.RZ006',
    level: 'SUGGEST',
    title: '版式一致性提醒',
    description: '明细行过多可能导致版式分页',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const threshold = Number(config.params?.line_item_threshold ?? 10);
      if (ctx.lineItemCount > threshold) {
        return [createIssue({
          level: config.level,
          rule_id: 'BUDGET.RZ006',
          message: `明细行数量${ctx.lineItemCount}超过阈值${threshold}，建议检查分页`,
          tolerance: config.tolerance,
          evidence: buildLineItemEvidence(ctx.lineItemCount, threshold)
        })];
      }
      return [];
    }
  },
  {
    rule_id: 'BUDGET.RZ007',
    level: 'FATAL',
    title: '文案占位符检查',
    description: '关键文案字段及明细原因中不应包含占位词',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const badManualKeys = [];
      for (const key of QUALITY_CHECK_MANUAL_KEYS) {
        const input = ctx.manualInputsByKey.get(key);
        if (!input) continue;
        if (containsPlaceholderToken(String(input.value_text || ''))) {
          badManualKeys.push(key);
        }
      }

      const badLineItems = (ctx.lineItems || [])
        .filter((item) => containsPlaceholderToken(String(item.reason_text || '')))
        .map((item) => item.item_key);

      if (badManualKeys.length === 0 && badLineItems.length === 0) {
        return [];
      }

      const messageParts = [];
      if (badManualKeys.length > 0) {
        messageParts.push(`手工文案字段存在占位词: ${badManualKeys.join(', ')}`);
      }
      if (badLineItems.length > 0) {
        messageParts.push(`明细原因存在占位词: ${badLineItems.length} 条`);
      }

      return [createIssue({
        level: config.level,
        rule_id: 'BUDGET.RZ007',
        message: messageParts.join('；'),
        tolerance: config.tolerance,
        evidence: {
          anchor: 'quality_placeholder_check',
          manual_keys: badManualKeys,
          line_item_keys: badLineItems
        }
      })];
    }
  },
  {
    rule_id: 'REASON_REQUIRED_MISSING',
    level: 'FATAL',
    title: '财政拨款支出主要内容原因必填',
    description: '必填条目未填写原因',
    tolerance: DEFAULT_TOLERANCE,
    run: (ctx, config) => {
      const missingItems = (ctx.lineItems || []).filter((item) => {
        if (!item.reason_required) {
          return false;
        }

        if (typeof item.reason_is_manual === 'boolean') {
          return !item.reason_is_manual;
        }

        return !item.reason_text || item.reason_text.trim() === '';
      });

      return missingItems.map((item) => createIssue({
        level: config.level,
        rule_id: 'REASON_REQUIRED_MISSING',
        message: `条目“${item.item_label}”缺少必填原因`,
        tolerance: config.tolerance,
        evidence: buildMissingReasonEvidence(ctx.draft.id, item.item_key, ctx.reasonThreshold)
      }));
    }
  }
];

const getDraftOrThrow = async (draftId, user) => {
  const draftResult = await db.query(
    `SELECT d.id,
            d.unit_id,
            d.year,
            d.upload_id,
            d.created_by,
            d.status,
            d.created_at,
            d.updated_at,
            u.name AS unit_name
     FROM report_draft d
     LEFT JOIN org_unit u ON u.id = d.unit_id
     WHERE d.id = $1`,
    [draftId]
  );

  if (draftResult.rowCount === 0) {
    throw new AppError({
      statusCode: 404,
      code: 'DRAFT_NOT_FOUND',
      message: 'Draft not found'
    });
  }

  const draft = draftResult.rows[0];
  ensureDraftAccess(draft, user);
  return draft;
};

const loadRuleConfigs = async (ruleIds) => {
  const configResult = await db.query(
    `SELECT rule_id, is_enabled, level_override, params_json
     FROM validation_rule_config
     WHERE rule_id = ANY($1)`,
    [ruleIds]
  );

  const configMap = new Map();
  for (const row of configResult.rows) {
    configMap.set(row.rule_id, {
      is_enabled: row.is_enabled,
      level_override: row.level_override,
      params_json: row.params_json
    });
  }

  return configMap;
};

const evaluateRules = (ctx, configMap) => {
  const issues = [];

  for (const rule of rules) {
    const config = configMap.get(rule.rule_id);
    if (config && config.is_enabled === false) {
      continue;
    }

    const effective = {
      level: config?.level_override || rule.level,
      tolerance: rule.tolerance,
      params: config?.params_json || {}
    };

    const result = rule.run(ctx, effective) || [];
    issues.push(...result.map((issue) => ({
      ...issue,
      level: normalizeIssueLevel(issue.level || effective.level),
      tolerance: issue.tolerance ?? effective.tolerance
    })));
  }

  return issues;
};

const runValidation = async (draftId, options = {}) => {
  const draft = await getDraftOrThrow(draftId, options.user);
  const factsResult = await db.query(
    `SELECT key, value_numeric, evidence
     FROM facts_budget
     WHERE upload_id = $1`,
    [draft.upload_id]
  );

  const manualResult = await db.query(
    `SELECT key, value_json, value_text, value_numeric, evidence
     FROM manual_inputs
     WHERE draft_id = $1`,
    [draftId]
  );

  const lineItemsResult = await db.query(
    `SELECT COUNT(*) AS count
     FROM line_items_reason
     WHERE draft_id = $1`,
    [draftId]
  );

  const factsByKey = new Map(
    factsResult.rows.map((row) => [row.key, {
      key: row.key,
      value: row.value_numeric !== null ? Number(row.value_numeric) : null,
      evidence: row.evidence
    }])
  );

  const manualInputsByKey = new Map(
    manualResult.rows.map((row) => [row.key, {
      key: row.key,
      value_json: row.value_json,
      value_text: row.value_text,
      value_numeric: row.value_numeric,
      evidence: row.evidence
    }])
  );

  const lineItemCount = Number(lineItemsResult.rows[0].count || 0);

  const configMap = await loadRuleConfigs(rules.map((rule) => rule.rule_id));
  const requiredManualKeys = normalizeRequiredManualKeys(
    configMap.get('BUDGET.RZ004')?.params_json?.required_keys
  );
  const reasonThreshold = resolveReasonThreshold(
    configMap.get('REASON_REQUIRED_MISSING')?.params_json?.threshold
  );
  const lineItems = await getLineItems({
    draftId,
    uploadId: draft.upload_id,
    threshold: reasonThreshold,
    unitId: draft.unit_id,
    year: draft.year
  });

  const ctx = {
    draft,
    factsByKey,
    manualInputsByKey,
    requiredManualKeys,
    lineItemCount,
    lineItems,
    reasonThreshold
  };

  const issues = evaluateRules(ctx, configMap);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM validation_issues WHERE draft_id = $1', [draftId]);

    for (const issue of issues) {
      await client.query(
        `INSERT INTO validation_issues (draft_id, level, rule_id, message, tolerance, evidence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          draftId,
          issue.level,
          issue.rule_id,
          issue.message,
          issue.tolerance,
          issue.evidence ? JSON.stringify(issue.evidence) : null
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

  const fatal_count = issues.filter((issue) => issue.level === 'FATAL').length;
  const warn_count = issues.filter((issue) => issue.level === 'WARNING').length;
  const suggest_count = issues.filter((issue) => issue.level === 'SUGGEST').length;

  return {
    draft_id: draftId,
    fatal_count,
    warn_count,
    suggest_count,
    issues
  };
};

const fetchIssues = async (draftId, level) => {
  const result = await db.query(
    `SELECT id, level, rule_id, message, tolerance, evidence, created_at
     FROM validation_issues
     WHERE draft_id = $1
       AND ($2::text IS NULL OR level = $2)
     ORDER BY created_at ASC`,
    [draftId, level]
  );

  return result.rows;
};

module.exports = {
  rules,
  runValidation,
  fetchIssues,
  getDraftOrThrow,
  DEFAULT_TOLERANCE
};
