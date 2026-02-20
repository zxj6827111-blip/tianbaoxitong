const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');
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
const {
  generateReportVersion,
  generateReportPreview,
  getPreviewPdfPath,
  getPreviewExcelPath
} = require('../services/reportService');
const { sanitizeManualInputRow, sanitizeManualTextByKey } = require('../services/manualTextSanitizer');
const { createSuggestion, listDraftSuggestions } = require('../repositories/suggestionRepository');
const { getUploadFilePath } = require('../services/uploadStorage');
const { extractHistoryFactsFromTableData } = require('../services/historyFactAutoExtractor');
const { recalculateSheetFormulaCells } = require('../services/excelFormulaEvaluator');

const router = express.Router();

const DRAFT_STATUS = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  SUBMITTED: 'SUBMITTED',
  GENERATED: 'GENERATED'
};

const HISTORY_TEXT_CATEGORY_BY_KEY = {
  main_functions: 'FUNCTION',
  organizational_structure: 'STRUCTURE',
  glossary: 'TERMINOLOGY',
  budget_explanation: 'EXPLANATION',
  budget_overview: 'EXPLANATION_OVERVIEW',
  budget_change_reason: 'EXPLANATION_CHANGE_REASON',
  change_reason: 'EXPLANATION_CHANGE_REASON',
  fiscal_detail: 'EXPLANATION_FISCAL_DETAIL',
  three_public_explanation: 'OTHER_THREE_PUBLIC'
};

const BUDGET_CHANGE_REASON_LINE_REGEX = /财政拨款收入支出(?:增加（减少）|增加|减少|持平)?的主要原因是[:：]?\s*[^。\n；;]+/;

const extractBudgetChangeReasonLine = (text) => {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const matched = source.match(BUDGET_CHANGE_REASON_LINE_REGEX);
  if (!matched || !matched[0]) return '';
  const normalized = matched[0].trim().replace(/[。；;]+$/g, '');
  return normalized ? `${normalized}。` : '';
};

const DIFF_FACT_KEYS = [
  { key: 'budget_revenue_total', label: '收入预算合计' },
  { key: 'budget_expenditure_total', label: '支出预算合计' },
  { key: 'fiscal_grant_revenue_total', label: '财政拨款收入合计' },
  { key: 'fiscal_grant_expenditure_total', label: '财政拨款支出合计' },
  { key: 'budget_expenditure_basic', label: '基本支出' },
  { key: 'budget_expenditure_project', label: '项目支出' },
  { key: 'budget_revenue_business', label: '事业收入' },
  { key: 'budget_revenue_operation', label: '事业单位经营收入' },
  { key: 'budget_revenue_other', label: '其他收入' },
  { key: 'fiscal_grant_expenditure_general', label: '一般公共预算拨款支出' },
  { key: 'fiscal_grant_expenditure_gov_fund', label: '政府性基金拨款支出' },
  { key: 'fiscal_grant_expenditure_capital', label: '国有资本经营预算拨款支出' }
];

const BUDGET_TABLE_DEFS = [
  {
    key: 'table_financial_summary',
    title: '2026年部门财务收支预算总表',
    patterns: [/财务收支.*总表/, /收支.*总表/],
    hints: ['1.3部门财务收支总表', '部门财务收支总表'],
    keywords: ['财务', '收支', '总表']
  },
  {
    key: 'table_income_summary',
    title: '2026年部门收入预算总表',
    patterns: [/收入.*预算.*总表/, /收入.*总表/],
    hints: ['1.1部门收入预算总表', '部门收入总表'],
    keywords: ['收入', '预算', '总表']
  },
  {
    key: 'table_expenditure_summary',
    title: '2026年部门支出预算总表',
    patterns: [/支出.*预算.*总表/, /支出.*总表/],
    hints: ['1.2部门支出预算总表', '部门支出总表'],
    keywords: ['支出', '预算', '总表']
  },
  {
    key: 'table_fiscal_grant_summary',
    title: '2026年部门财政拨款收支预算总表',
    patterns: [/财政拨款.*收支.*总表/, /财政拨款.*预算.*总表/],
    hints: ['1.4部门财政拨款收支预算总表', '财政拨款收支总表'],
    keywords: ['财政拨款', '收支', '总表']
  },
  {
    key: 'table_general_public_function',
    title: '2026年部门一般公共预算支出功能分类预算表',
    patterns: [/一般公共预算.*支出.*功能.*分类.*预算表/],
    hints: ['1.5部门一般公共预算支出功能分类预算表', '一般公共预算功能分类预算表'],
    keywords: ['一般公共预算', '功能', '分类', '支出']
  },
  {
    key: 'table_gov_fund_function',
    title: '2026年部门政府性基金预算支出功能分类预算表',
    patterns: [/政府性基金.*支出.*功能.*分类.*预算表/],
    hints: ['1.6部门政府性基金预算支出功能分类预算表', '政府性基金功能分类预算表'],
    keywords: ['政府性基金', '功能', '分类', '支出']
  },
  {
    key: 'table_state_capital_function',
    title: '2026年部门国有资本经营预算支出功能分类预算表',
    patterns: [/国有资本经营预算.*支出.*功能.*分类.*预算表/],
    hints: ['1.7部门国有资本经营预算支出功能分类预算表', '国有资本经营功能分类预算表'],
    keywords: ['国有资本经营预算', '功能', '分类', '支出']
  },
  {
    key: 'table_general_public_basic_econ',
    title: '2026年部门一般公共预算基本支出部门预算经济分类预算表',
    patterns: [/一般公共预算.*基本支出.*经济分类.*预算表/],
    hints: ['1.8部门一般公共预算基本支出部门预算经济分类预算表', '基本支出经济分类预算表'],
    keywords: ['一般公共预算', '基本支出', '经济分类']
  },
  {
    key: 'table_three_public_operation',
    title: '2026年部门“三公”经费和机关运行经费预算表',
    patterns: [/(三公|“三公”|\"三公\").*(机关运行|运行经费).*预算表/],
    hints: ['1.9部门“三公”经费和机关运行经费预算表', '三公经费和机关运行经费预算表'],
    keywords: ['三公', '机关运行', '经费', '预算表']
  }
];

const BUDGET_TABLE_CACHE_TTL_MS = 20 * 1000;
const budgetTableCache = new Map();

const normalizeSheetName = (name) => String(name || '').replace(/\s+/g, '');
const normalizeDiagText = (value) => normalizeSheetName(value).replace(/[“”"']/g, '');

const sendFileOr404 = async (res, filePath, contentType, filename) => {
  if (!filePath) {
    throw new AppError({
      statusCode: 404,
      code: 'FILE_NOT_FOUND',
      message: 'File not found'
    });
  }

  const resolved = path.resolve(filePath);
  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(resolved);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new AppError({
        statusCode: 404,
        code: 'FILE_NOT_FOUND',
        message: 'File not found'
      });
    }
    throw error;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(fileBuffer);
};

const previewExistsForDraft = async ({ draftId, userId }) => {
  const previewPath = path.resolve(getPreviewPdfPath({ draftId, userId }));
  try {
    await fs.access(previewPath);
    return true;
  } catch {
    return false;
  }
};

const trimTrailingEmptyCells = (row) => {
  const values = Array.isArray(row) ? row.map((value) => (value === null || value === undefined ? '' : String(value))) : [];
  let end = values.length - 1;
  while (end >= 0 && values[end].trim() === '') {
    end -= 1;
  }
  return values.slice(0, end + 1);
};

const trimTrailingEmptyRows = (rows) => {
  let end = rows.length - 1;
  while (end >= 0) {
    const row = rows[end];
    if (row.some((cell) => String(cell || '').trim() !== '')) {
      break;
    }
    end -= 1;
  }
  return rows.slice(0, end + 1);
};

const extractSheetRows = (sheet) => {
  recalculateSheetFormulaCells(sheet);
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ''
  });
  const normalizedRows = rawRows.map((row) => trimTrailingEmptyCells(row));
  return trimTrailingEmptyRows(normalizedRows);
};

const getColumnCount = (rows) => rows.reduce((max, row) => Math.max(max, row.length), 0);

const parseAmountLikeCell = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!raw || raw === '-' || raw === '.' || raw === '-.') return null;
  const normalized = /^\((.+)\)$/.test(raw) ? raw.replace(/^\((.+)\)$/, '-$1') : raw;
  const matched = normalized.match(/^[-+]?\d+(\.\d+)?(?:万元|万|元)?$/);
  if (!matched) return null;
  const parsed = Number(normalized.replace(/(?:万元|万|元)$/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const toRoundedNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
};

const normalizeThreePublicCurrentValues = (input) => {
  const base = {
    three_public_total: null,
    three_public_outbound: null,
    three_public_vehicle_total: null,
    three_public_vehicle_purchase: null,
    three_public_vehicle_operation: null,
    three_public_reception: null,
    operation_fund: null
  };

  for (const key of Object.keys(base)) {
    const parsed = toRoundedNumber(input?.[key]);
    base[key] = parsed;
  }

  const vehiclePurchase = base.three_public_vehicle_purchase;
  const vehicleOperation = base.three_public_vehicle_operation;
  const vehicleTotal = base.three_public_vehicle_total;
  const canDeriveVehicleTotal = Number.isFinite(vehiclePurchase) && Number.isFinite(vehicleOperation);
  const derivedVehicleTotal = canDeriveVehicleTotal
    ? toRoundedNumber(vehiclePurchase + vehicleOperation)
    : null;

  if (derivedVehicleTotal !== null) {
    const vehicleTotalMissing = vehicleTotal === null;
    const vehicleTotalLooksBlank = vehicleTotal !== null && Math.abs(vehicleTotal) < 0.0001 && Math.abs(derivedVehicleTotal) > 0.0001;
    if (vehicleTotalMissing || vehicleTotalLooksBlank) {
      base.three_public_vehicle_total = derivedVehicleTotal;
    }
  }

  const outbound = base.three_public_outbound;
  const reception = base.three_public_reception;
  const total = base.three_public_total;
  const canDeriveTotal = Number.isFinite(outbound)
    && Number.isFinite(reception)
    && Number.isFinite(base.three_public_vehicle_total);
  const derivedTotal = canDeriveTotal
    ? toRoundedNumber(outbound + reception + base.three_public_vehicle_total)
    : null;

  if (derivedTotal !== null) {
    const totalMissing = total === null;
    const totalLooksBlank = total !== null && Math.abs(total) < 0.0001 && Math.abs(derivedTotal) > 0.0001;
    if (totalMissing || totalLooksBlank) {
      base.three_public_total = derivedTotal;
    }
  }

  return base;
};

const toWanyuanFromYuan = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number((parsed / 10000).toFixed(2));
};

const toYuanFromWanyuan = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number((parsed * 10000).toFixed(2));
};

const toFiniteNumberOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const loadPreviousBudgetValuesByKey = async ({ unitId, year, keys }) => {
  const result = new Map();
  if (!unitId || !year || !Array.isArray(keys) || keys.length === 0) {
    return result;
  }

  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) {
    return result;
  }

  const historyResult = await db.query(
    `SELECT key, value_numeric, stage
     FROM history_actuals
     WHERE unit_id = $1
       AND year = $2
       AND stage = ANY($3)
       AND key = ANY($4)
     ORDER BY
       CASE stage
         WHEN 'BUDGET' THEN 0
         WHEN 'FINAL' THEN 1
         ELSE 2
       END ASC`,
    [unitId, prevYear, ['BUDGET', 'FINAL'], keys]
  );

  historyResult.rows.forEach((row) => {
    if (result.has(row.key)) return;
    if (row.value_numeric === null || row.value_numeric === undefined) return;
    const value = Number(row.value_numeric);
    if (!Number.isFinite(value)) return;
    result.set(row.key, {
      value,
      source: row.stage === 'BUDGET' ? 'history_actuals_budget' : 'history_actuals_final'
    });
  });

  const factsResult = await db.query(
    `SELECT key, value_numeric
     FROM facts_budget
     WHERE unit_id = $1 AND year = $2 AND key = ANY($3)`,
    [unitId, prevYear, keys]
  );

  factsResult.rows.forEach((row) => {
    if (result.has(row.key)) return;
    const converted = toWanyuanFromYuan(row.value_numeric);
    if (!Number.isFinite(converted)) return;
    result.set(row.key, { value: converted, source: 'facts_budget' });
  });

  return result;
};

const matchSheet = (sheetNames, patterns) => {
  for (const sheetName of sheetNames) {
    const normalized = normalizeSheetName(sheetName);
    const matched = patterns.some((pattern) => pattern.test(normalized));
    if (matched) {
      return sheetName;
    }
  }
  return null;
};

const matchRowByKeywords = (rows, includeKeywords = [], excludeKeywords = []) => {
  if (!Array.isArray(rows)) return null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;
    const rowText = row.map((cell) => String(cell || '')).join('');
    if (!rowText) continue;
    if (includeKeywords.length > 0 && !includeKeywords.every((keyword) => rowText.includes(keyword))) {
      continue;
    }
    if (excludeKeywords.some((keyword) => rowText.includes(keyword))) {
      continue;
    }
    const numbers = row
      .map((cell) => parseAmountLikeCell(cell))
      .filter((value) => value !== null);
    if (numbers.length === 0) {
      continue;
    }
    const current = numbers[numbers.length - 1];
    const previous = numbers.length >= 2 ? numbers[numbers.length - 2] : null;
    return {
      row_index: rowIndex,
      row_text: rowText,
      current,
      previous
    };
  }
  return null;
};

const findDiagnosisCandidates = (availableSheets, keywords) => {
  if (!Array.isArray(availableSheets) || !Array.isArray(keywords) || keywords.length === 0) {
    return [];
  }

  const candidates = [];
  for (const sheetName of availableSheets) {
    const normalized = normalizeDiagText(sheetName);
    const matchedKeywords = keywords.filter((keyword) => normalized.includes(normalizeDiagText(keyword)));
    if (matchedKeywords.length === 0) {
      continue;
    }
    candidates.push({
      sheet_name: sheetName,
      score: matchedKeywords.length,
      matched_keywords: matchedKeywords
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.sheet_name.localeCompare(b.sheet_name))
    .slice(0, 5);
};

const loadDraftBudgetTables = async (draft) => {
  const uploadResult = await db.query(
    `SELECT id, file_name
     FROM upload_job
     WHERE id = $1`,
    [draft.upload_id]
  );

  if (uploadResult.rowCount === 0) {
    throw new AppError({
      statusCode: 404,
      code: 'UPLOAD_NOT_FOUND',
      message: 'Upload not found for draft'
    });
  }

  const upload = uploadResult.rows[0];
  const cacheKey = `${upload.id}:${upload.file_name}`;
  const cached = budgetTableCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BUDGET_TABLE_CACHE_TTL_MS) {
    return cached.payload;
  }

  const filePath = getUploadFilePath(upload.id, upload.file_name);
  let workbook;
  try {
    workbook = XLSX.readFile(filePath, {
      cellFormula: true,
      cellHTML: false,
      cellNF: true,
      cellStyles: false
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new AppError({
        statusCode: 404,
        code: 'UPLOAD_FILE_NOT_FOUND',
        message: 'Uploaded Excel file not found'
      });
    }
    throw error;
  }

  const sheetNames = workbook.SheetNames || [];
  const tableMap = new Map();

  for (const def of BUDGET_TABLE_DEFS) {
    const sheetName = matchSheet(sheetNames, def.patterns);
    if (!sheetName) {
      tableMap.set(def.key, {
        key: def.key,
        title: def.title,
        sheet_name: null,
        status: 'MISSING',
        row_count: 0,
        col_count: 0,
        rows: []
      });
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = extractSheetRows(sheet);
    tableMap.set(def.key, {
      key: def.key,
      title: def.title,
      sheet_name: sheetName,
      status: 'READY',
      row_count: rows.length,
      col_count: getColumnCount(rows),
      rows
    });
  }

  const payload = {
    year: draft.year,
    tables: BUDGET_TABLE_DEFS.map((def) => tableMap.get(def.key)),
    available_sheets: sheetNames
  };

  budgetTableCache.set(cacheKey, {
    at: Date.now(),
    payload
  });

  return payload;
};

const isAdminLike = (user) => {
  const roles = user?.roles || [];
  return roles.includes('admin') || roles.includes('maintainer');
};

const parseIfMatchUpdatedAt = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new AppError({
      statusCode: 400,
      code: 'IF_MATCH_INVALID',
      message: 'if_match_updated_at must be a valid datetime string'
    });
  }

  return normalized;
};

const throwStaleOrNotFound = async (client, draftId) => {
  const exists = await client.query(
    `SELECT id FROM report_draft WHERE id = $1`,
    [draftId]
  );

  if (exists.rowCount === 0) {
    throw new AppError({
      statusCode: 404,
      code: 'DRAFT_NOT_FOUND',
      message: 'Draft not found'
    });
  }

  throw new AppError({
    statusCode: 409,
    code: 'STALE_DRAFT',
    message: 'Draft has been updated by another session, please refresh'
  });
};

const updateDraftState = async ({ client, draftId, status, ifMatchUpdatedAt = null }) => {
  const params = [status, draftId];
  let where = 'id = $2';

  if (ifMatchUpdatedAt) {
    params.push(ifMatchUpdatedAt);
    where += ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${params.length}::timestamptz)`;
  }

  const result = await client.query(
    `UPDATE report_draft
     SET status = $1,
         updated_at = now()
     WHERE ${where}
     RETURNING id, unit_id, year, template_version, status, upload_id, created_by, created_at, updated_at`,
    params
  );

  if (result.rowCount === 0) {
    await throwStaleOrNotFound(client, draftId);
  }

  const updatedDraft = result.rows[0];
  const unitResult = await client.query(
    `SELECT name
     FROM org_unit
     WHERE id = $1`,
    [updatedDraft.unit_id]
  );

  return {
    ...updatedDraft,
    unit_name: unitResult.rows[0]?.name || null
  };
};

const appendAuditLog = async ({ client, req, userId, action, entityId, meta = null }) => {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json, ip, user_agent)
     VALUES ($1, $2, 'report_draft', $3, $4, $5, $6)`,
    [
      userId || null,
      action,
      entityId,
      meta ? JSON.stringify(meta) : null,
      req.ip || null,
      req.headers['user-agent'] || null
    ]
  );
};

const getCopySourceDrafts = async ({ unitId, year, excludeDraftId, sourceDraftId = null }) => {
  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) {
    return [];
  }

  const params = [unitId, prevYear, excludeDraftId];
  let where = 'd.unit_id = $1 AND d.year = $2 AND d.id <> $3';

  if (sourceDraftId) {
    params.push(sourceDraftId);
    where += ` AND d.id = $${params.length}`;
  }

  const result = await db.query(
    `SELECT d.id,
            d.year,
            d.status,
            d.updated_at,
            uj.file_name
     FROM report_draft d
     LEFT JOIN upload_job uj ON uj.id = d.upload_id
     WHERE ${where}
     ORDER BY d.updated_at DESC NULLS LAST, d.id DESC`,
    params
  );

  return result.rows;
};

const getReceipt = async (draftId) => {
  const draftResult = await db.query(
    `SELECT d.id,
            d.year,
            d.status,
            d.created_at,
            d.updated_at,
            d.unit_id,
            u.name AS unit_name
     FROM report_draft d
     LEFT JOIN org_unit u ON u.id = d.unit_id
     WHERE d.id = $1`,
    [draftId]
  );

  if (draftResult.rowCount === 0) {
    return null;
  }

  const draft = draftResult.rows[0];

  const versionResult = await db.query(
    `SELECT id, version_no, generated_at
     FROM report_version
     WHERE draft_id = $1
     ORDER BY version_no DESC
     LIMIT 1`,
    [draftId]
  );

  const auditResult = await db.query(
    `SELECT action, created_at, meta_json
     FROM audit_log
     WHERE entity_type = 'report_draft'
       AND entity_id = $1
       AND action = ANY($2)
     ORDER BY created_at ASC`,
    [draftId, ['DRAFT_VALIDATED', 'DRAFT_SUBMITTED', 'REPORT_GENERATED', 'DRAFT_COPIED_FROM_PREVIOUS']]
  );

  const timeline = [
    { action: 'DRAFT_CREATED', label: '草稿创建', at: draft.created_at }
  ];

  auditResult.rows.forEach((item) => {
    const labels = {
      DRAFT_VALIDATED: '校验完成',
      DRAFT_SUBMITTED: '已提交',
      REPORT_GENERATED: '报告已生成',
      DRAFT_COPIED_FROM_PREVIOUS: '已复制上期内容'
    };

    timeline.push({
      action: item.action,
      label: labels[item.action] || item.action,
      at: item.created_at,
      meta: item.meta_json || null
    });
  });

  return {
    receipt_no: `${draft.year}-${String(draft.id).slice(0, 8)}`,
    draft,
    latest_report_version: versionResult.rows[0] || null,
    timeline
  };
};

const getDraftWithAccess = async (draftId, user) => getDraftOrThrow(draftId, user);

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const year = req.query.year ? Number(req.query.year) : null;
    const unitId = req.query.unit_id ? String(req.query.unit_id) : null;

    const where = [];
    const params = [];

    if (isAdminLike(req.user)) {
      if (unitId) {
        params.push(unitId);
        where.push(`d.unit_id = $${params.length}`);
      }
    } else if (req.user?.unit_id) {
      params.push(req.user.unit_id);
      where.push(`d.unit_id = $${params.length}`);
    } else {
      params.push(req.user.id);
      where.push(`d.created_by = $${params.length}`);
    }

    if (year !== null && Number.isInteger(year)) {
      params.push(year);
      where.push(`d.year = $${params.length}`);
    }

    params.push(limit);
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT d.id,
              d.unit_id,
              d.year,
              d.status,
              d.template_version,
              d.created_at,
              d.updated_at,
              d.upload_id,
              u.name AS unit_name,
              uj.caliber,
              uj.file_name
       FROM report_draft d
       LEFT JOIN org_unit u ON u.id = d.unit_id
       LEFT JOIN upload_job uj ON uj.id = d.upload_id
       ${whereClause}
       ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({
      drafts: result.rows,
      limit
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);

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

    const sanitizedManualInputs = manualInputsResult.rows.map(sanitizeManualInputRow);

    return res.json({
      draft,
      facts_budget: {
        items: factsResult.rows,
        total: Number(countResult.rows[0].total),
        page,
        pageSize
      },
      manual_inputs: sanitizedManualInputs
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/receipt', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const receipt = await getReceipt(draft.id);
    return res.json({ draft_id: draft.id, receipt });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/copy-sources', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const sources = await getCopySourceDrafts({
      unitId: draft.unit_id,
      year: draft.year,
      excludeDraftId: draft.id
    });

    return res.json({
      draft_id: draft.id,
      source_year: Number(draft.year) - 1,
      sources
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/diff-summary', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const prevYear = Number(draft.year) - 1;

    if (!Number.isInteger(prevYear) || prevYear <= 0) {
      return res.json({
        draft_id: draft.id,
        source_year: null,
        items: []
      });
    }

    const keys = DIFF_FACT_KEYS.map((item) => item.key);
    const labels = new Map(DIFF_FACT_KEYS.map((item) => [item.key, item.label]));

    const currentResult = await db.query(
      `SELECT key, value_numeric
       FROM facts_budget
       WHERE upload_id = $1 AND key = ANY($2)`,
      [draft.upload_id, keys]
    );

    const previousWanyuanMap = await loadPreviousBudgetValuesByKey({
      unitId: draft.unit_id,
      year: draft.year,
      keys
    });

    const currentMap = new Map();
    currentResult.rows.forEach((row) => {
      const value = toFiniteNumberOrNull(row.value_numeric);
      if (value !== null) {
        currentMap.set(row.key, value);
      }
    });

    const items = keys.map((key) => {
      const currentValue = currentMap.has(key) ? Number(currentMap.get(key)) : null;
      const previousWanyuan = previousWanyuanMap.has(key)
        ? previousWanyuanMap.get(key).value
        : null;
      const previousValue = previousWanyuan === null || previousWanyuan === undefined
        ? null
        : toYuanFromWanyuan(previousWanyuan);

      const diff = currentValue !== null && previousValue !== null
        ? Number((currentValue - previousValue).toFixed(2))
        : null;

      const ratio = diff !== null && previousValue && previousValue !== 0
        ? Number((diff / Math.abs(previousValue)).toFixed(4))
        : null;

      return {
        key,
        label: labels.get(key) || key,
        current_value: currentValue,
        previous_value: previousValue,
        diff_value: diff,
        diff_ratio: ratio
      };
    });

    return res.json({
      draft_id: draft.id,
      source_year: prevYear,
      items
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/budget-tables', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const payload = await loadDraftBudgetTables(draft);

    return res.json({
      draft_id: draft.id,
      year: payload.year,
      tables: payload.tables.map((table) => ({
        key: table.key,
        title: table.title.replace('2026', String(draft.year)),
        sheet_name: table.sheet_name,
        status: table.status,
        row_count: table.row_count,
        col_count: table.col_count
      })),
      available_sheets: payload.available_sheets
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/budget-tables/:tableKey', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const tableKey = String(req.params.tableKey || '');
    const payload = await loadDraftBudgetTables(draft);
    const table = payload.tables.find((item) => item.key === tableKey);

    if (!table) {
      throw new AppError({
        statusCode: 404,
        code: 'BUDGET_TABLE_NOT_FOUND',
        message: `Budget table key not found: ${tableKey}`
      });
    }

    return res.json({
      draft_id: draft.id,
      year: payload.year,
      table: {
        key: table.key,
        title: table.title.replace('2026', String(draft.year)),
        sheet_name: table.sheet_name,
        status: table.status,
        row_count: table.row_count,
        col_count: table.col_count,
        rows: table.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/budget-tables-diagnose', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const payload = await loadDraftBudgetTables(draft);
    const tableMap = new Map(payload.tables.map((table) => [table.key, table]));

    const diagnostics = BUDGET_TABLE_DEFS.map((def) => {
      const table = tableMap.get(def.key);
      const status = table?.status || 'MISSING';
      const candidates = status === 'READY'
        ? []
        : findDiagnosisCandidates(payload.available_sheets, def.keywords || []);

      return {
        key: def.key,
        title: def.title.replace('2026', String(draft.year)),
        status,
        matched_sheet_name: table?.sheet_name || null,
        expected_sheet_hints: (def.hints || []).map((name) => name.replace('2026', String(draft.year))),
        candidates
      };
    });

    const summary = {
      total: diagnostics.length,
      ready: diagnostics.filter((item) => item.status === 'READY').length,
      missing: diagnostics.filter((item) => item.status !== 'READY').length
    };

    const suggestions = summary.missing > 0
      ? [
        '优先检查上传Excel是否为“部门口径”模板，且包含完整9张预算表。',
        '若工作表命名不一致，可按诊断中的“推荐名称”重命名后重新上传。',
        '若模板版本差异较大，可将当前Excel工作表名称反馈给管理员补充映射规则。'
      ]
      : ['9张预算表均已识别，无需额外处理。'];

    return res.json({
      draft_id: draft.id,
      year: draft.year,
      summary,
      available_sheets: payload.available_sheets,
      diagnostics,
      suggestions
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/other-related-auto', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const payload = await loadDraftBudgetTables(draft);
    const tableMap = new Map(payload.tables.map((table) => [table.key, table]));
    const threePublicTable = tableMap.get('table_three_public_operation');
    const rows = Array.isArray(threePublicTable?.rows) ? threePublicTable.rows : [];

    const titleLikeExcludes = ['预算表', '编制部门', '单位:', '单位：', '部门预算'];
    const defs = [
      { key: 'three_public_total', label: '三公经费合计', include: ['三公', '预算数'], exclude: ['购置及运行费', '购置费', '运行费', '接待费', ...titleLikeExcludes] },
      { key: 'three_public_outbound', label: '因公出国（境）费', include: ['因公', '出国'], exclude: titleLikeExcludes },
      { key: 'three_public_vehicle_total', label: '公务用车购置及运行费', include: ['公务用车', '购置及运行费'], exclude: ['购置费', '运行费', ...titleLikeExcludes] },
      { key: 'three_public_vehicle_purchase', label: '公务用车购置费', include: ['公务用车', '购置费'], exclude: ['购置及运行费', ...titleLikeExcludes] },
      { key: 'three_public_vehicle_operation', label: '公务用车运行费', include: ['公务用车', '运行费'], exclude: ['购置及运行费', ...titleLikeExcludes] },
      { key: 'three_public_reception', label: '公务接待费', include: ['公务接待费'], exclude: titleLikeExcludes },
      { key: 'operation_fund', label: '机关运行经费', include: ['机关运行经费'], exclude: titleLikeExcludes }
    ];

    const currentValueMap = normalizeThreePublicCurrentValues(
      extractHistoryFactsFromTableData([
        {
          table_key: 'three_public',
          data_json: rows
        }
      ])
    );

    const previousValueMap = await loadPreviousBudgetValuesByKey({
      unitId: draft.unit_id,
      year: draft.year,
      keys: defs.map((def) => def.key)
    });

    const autoValues = {};
    const unavailableFields = [];

    defs.forEach((def) => {
      const currentFromStructured = Number.isFinite(Number(currentValueMap?.[def.key]))
        ? Number(currentValueMap[def.key])
        : null;
      const match = currentFromStructured === null ? matchRowByKeywords(rows, def.include, def.exclude) : null;
      autoValues[def.key] = {
        current: currentFromStructured !== null ? currentFromStructured : (match ? match.current : null),
        previous: match ? match.previous : null,
        source: currentFromStructured !== null
          ? {
            table_key: 'table_three_public_operation',
            sheet_name: threePublicTable?.sheet_name || null,
            row_index: null,
            extractor: 'history_fact_auto'
          }
          : (match
            ? {
              table_key: 'table_three_public_operation',
              sheet_name: threePublicTable?.sheet_name || null,
              row_index: match.row_index
            }
            : null)
      };

      if (autoValues[def.key].previous === null && previousValueMap.has(def.key)) {
        const fallback = previousValueMap.get(def.key);
        autoValues[def.key].previous = fallback.value;
        autoValues[def.key].source = {
          ...(autoValues[def.key].source || {}),
          previous_source: fallback.source
        };
      }

      if (autoValues[def.key].current === null || autoValues[def.key].current === undefined) {
        unavailableFields.push({
          key: def.key,
          label: def.label,
          reason: threePublicTable?.status === 'READY'
            ? '表中未匹配到对应行，请手动填写'
            : '未识别到“三公”预算表，请手动填写'
        });
      }
    });

    const procurementFallback = await db.query(
      `SELECT key, value_numeric
       FROM manual_inputs
       WHERE draft_id = $1 AND key IN ('procurement_amount', 'asset_total')`,
      [draft.id]
    );
    const manualNumericMap = new Map(procurementFallback.rows.map((row) => [row.key, row.value_numeric !== null ? Number(row.value_numeric) : null]));

    autoValues.procurement_total = {
      current: manualNumericMap.get('procurement_amount') ?? null,
      previous: null,
      source: manualNumericMap.has('procurement_amount') ? { table_key: null, sheet_name: null, row_index: null } : null
    };
    autoValues.asset_total = {
      current: manualNumericMap.get('asset_total') ?? null,
      previous: null,
      source: manualNumericMap.has('asset_total') ? { table_key: null, sheet_name: null, row_index: null } : null
    };

    if (autoValues.procurement_total.current === null) {
      unavailableFields.push({
        key: 'procurement_total',
        label: '政府采购预算总额',
        reason: '当前模板未解析到政府采购预算总额，请手动填写'
      });
    }
    if (autoValues.asset_total.current === null) {
      unavailableFields.push({
        key: 'asset_total',
        label: '资产总额',
        reason: '当前模板未解析到资产总额，请手动填写'
      });
    }

    const totalAutoFields = Object.keys(autoValues).length;
    const extractedFields = Object.values(autoValues).filter((value) => value && value.current !== null).length;

    return res.json({
      draft_id: draft.id,
      year: draft.year,
      source_table: {
        key: threePublicTable?.key || 'table_three_public_operation',
        title: threePublicTable?.title?.replace('2026', String(draft.year)) || `${draft.year}年部门“三公”经费和机关运行经费预算表`,
        status: threePublicTable?.status || 'MISSING',
        sheet_name: threePublicTable?.sheet_name || null
      },
      auto_values: autoValues,
      coverage: {
        extracted_fields: extractedFields,
        total_fields: totalAutoFields
      },
      unavailable_fields: unavailableFields,
      suggestions: [
        '已自动提取的字段可直接使用，必要时可人工修正。',
        '无法提取的字段请按模板要求手动补充。',
        '填写完成后系统会自动生成“其他相关情况说明”全文。'
      ]
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/manual-inputs', requireAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const inputs = req.body?.inputs;
    const ifMatchUpdatedAt = parseIfMatchUpdatedAt(req.body?.if_match_updated_at);

    if (!Array.isArray(inputs)) {
      throw new AppError({
        statusCode: 400,
        code: 'INVALID_INPUT',
        message: 'inputs must be an array'
      });
    }

    await client.query('BEGIN');

    for (const input of inputs) {
      const { key, value_text, value_numeric } = input;

      if (!key || typeof key !== 'string') {
        throw new AppError({
          statusCode: 400,
          code: 'INVALID_INPUT_KEY',
          message: 'Each input must have a valid key'
        });
      }

      const sanitizedValueText = sanitizeManualTextByKey(key, value_text);

      await client.query(
        `INSERT INTO manual_inputs (draft_id, key, value_text, value_numeric, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (draft_id, key)
         DO UPDATE SET
           value_text = EXCLUDED.value_text,
           value_numeric = EXCLUDED.value_numeric,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          draft.id,
          key,
          sanitizedValueText || null,
          value_numeric !== undefined && value_numeric !== null && value_numeric !== '' ? Number(value_numeric) : null,
          req.user.id
        ]
      );
    }

    const updatedDraft = await updateDraftState({
      client,
      draftId: draft.id,
      status: DRAFT_STATUS.DRAFT,
      ifMatchUpdatedAt
    });

    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'DRAFT_EDITED_MANUAL',
      entityId: draft.id,
      meta: { input_count: inputs.length }
    });

    await client.query('COMMIT');

    const manualInputsResult = await db.query(
      `SELECT id, key, value_json, value_text, value_numeric, evidence, notes, created_at, updated_at
       FROM manual_inputs
       WHERE draft_id = $1
       ORDER BY key ASC`,
      [draft.id]
    );

    return res.json({
      draft_id: draft.id,
      draft: updatedDraft,
      manual_inputs: manualInputsResult.rows.map(sanitizeManualInputRow)
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback failures when no active transaction exists.
    }
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/:id/history-text', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const key = req.query.key;
    if (!key || typeof key !== 'string') {
      throw new AppError({
        statusCode: 400,
        code: 'HISTORY_KEY_REQUIRED',
        message: 'key is required'
      });
    }

    const category = HISTORY_TEXT_CATEGORY_BY_KEY[key];
    if (!category) {
      return res.json({ content_text: null });
    }

    const unitResult = await db.query(
      `SELECT department_id
       FROM org_unit
       WHERE id = $1`,
      [draft.unit_id]
    );

    const departmentId = unitResult.rows[0]?.department_id || null;
    if (!departmentId) {
      return res.json({ content_text: null });
    }

    const prevYear = draft.year - 1;
    if (!Number.isInteger(prevYear) || prevYear <= 0) {
      return res.json({ content_text: null });
    }

    const textResult = await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2 AND report_type = 'BUDGET' AND category = $3`,
      [departmentId, prevYear, category]
    );

    let contentTextRaw = textResult.rows[0]?.content_text || null;

    // Backward compatibility: some historical archives only have EXPLANATION text,
    // without a dedicated EXPLANATION_CHANGE_REASON category.
    if ((!contentTextRaw || !String(contentTextRaw).trim()) && (key === 'budget_change_reason' || key === 'change_reason')) {
      const fallbackResult = await db.query(
        `SELECT category, content_text
         FROM org_dept_text_content
         WHERE department_id = $1
           AND year = $2
           AND report_type = 'BUDGET'
           AND category = ANY($3)
         ORDER BY
           CASE category
             WHEN 'EXPLANATION_CHANGE_REASON' THEN 0
             WHEN 'EXPLANATION' THEN 1
             WHEN 'EXPLANATION_OVERVIEW' THEN 2
             ELSE 3
           END`,
        [departmentId, prevYear, ['EXPLANATION_CHANGE_REASON', 'EXPLANATION', 'EXPLANATION_OVERVIEW']]
      );

      for (const row of fallbackResult.rows) {
        const candidate = extractBudgetChangeReasonLine(row.content_text);
        if (candidate) {
          contentTextRaw = candidate;
          break;
        }
      }
    }

    const contentText = sanitizeManualTextByKey(key, contentTextRaw);

    return res.json({
      content_text: contentText || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/copy-previous', requireAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const ifMatchUpdatedAt = parseIfMatchUpdatedAt(req.body?.if_match_updated_at);
    const sourceDraftId = req.body?.source_draft_id ? String(req.body.source_draft_id) : null;

    const sourceCandidates = await getCopySourceDrafts({
      unitId: draft.unit_id,
      year: draft.year,
      excludeDraftId: draft.id,
      sourceDraftId
    });

    if (sourceCandidates.length === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'PREVIOUS_DRAFT_NOT_FOUND',
        message: `No previous-year draft found for year ${Number(draft.year) - 1}`
      });
    }

    const sourceDraft = sourceCandidates[0];

    await client.query('BEGIN');

    const manualResult = await client.query(
      `INSERT INTO manual_inputs
        (draft_id, key, value_json, value_text, value_numeric, evidence, notes, updated_by, updated_at)
       SELECT $1, key, value_json, value_text, value_numeric, evidence, notes, $3, now()
       FROM manual_inputs
       WHERE draft_id = $2
       ON CONFLICT (draft_id, key)
       DO UPDATE SET
         value_json = EXCLUDED.value_json,
         value_text = EXCLUDED.value_text,
         value_numeric = EXCLUDED.value_numeric,
         evidence = EXCLUDED.evidence,
         notes = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING id`,
      [draft.id, sourceDraft.id, req.user.id]
    );

    const lineItemsResult = await client.query(
      `INSERT INTO line_items_reason
        (draft_id, item_key, sort_order, order_no, reason_text, updated_by, updated_at)
       SELECT
         $1,
         item_key,
         COALESCE(order_no, sort_order, 0),
         COALESCE(order_no, sort_order, 0),
         reason_text,
         $3,
         now()
       FROM line_items_reason
       WHERE draft_id = $2
       ON CONFLICT (draft_id, item_key)
       DO UPDATE SET
         sort_order = EXCLUDED.sort_order,
         order_no = EXCLUDED.order_no,
         reason_text = EXCLUDED.reason_text,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING id`,
      [draft.id, sourceDraft.id, req.user.id]
    );

    const updatedDraft = await updateDraftState({
      client,
      draftId: draft.id,
      status: DRAFT_STATUS.DRAFT,
      ifMatchUpdatedAt
    });

    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'DRAFT_COPIED_FROM_PREVIOUS',
      entityId: draft.id,
      meta: {
        source_draft_id: sourceDraft.id,
        source_year: sourceDraft.year,
        copied_manual_inputs: manualResult.rowCount,
        copied_line_items: lineItemsResult.rowCount
      }
    });

    await client.query('COMMIT');

    return res.json({
      draft_id: draft.id,
      draft: updatedDraft,
      source_draft_id: sourceDraft.id,
      source_year: sourceDraft.year,
      copied_manual_inputs: manualResult.rowCount,
      copied_line_items: lineItemsResult.rowCount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/:id/validate', requireAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const ifMatchUpdatedAt = parseIfMatchUpdatedAt(req.body?.if_match_updated_at);

    const result = await runValidation(draft.id, { user: req.user });
    const nextStatus = result.fatal_count > 0 ? DRAFT_STATUS.DRAFT : DRAFT_STATUS.VALIDATED;

    await client.query('BEGIN');
    const updatedDraft = await updateDraftState({
      client,
      draftId: draft.id,
      status: nextStatus,
      ifMatchUpdatedAt
    });

    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'DRAFT_VALIDATED',
      entityId: draft.id,
      meta: {
        fatal_count: result.fatal_count,
        warn_count: result.warn_count,
        suggest_count: result.suggest_count
      }
    });

    await client.query('COMMIT');

    return res.json({
      ...result,
      draft: updatedDraft
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/:id/submit', requireAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const ifMatchUpdatedAt = parseIfMatchUpdatedAt(req.body?.if_match_updated_at);

    if (draft.status !== DRAFT_STATUS.VALIDATED && draft.status !== DRAFT_STATUS.SUBMITTED) {
      throw new AppError({
        statusCode: 409,
        code: 'DRAFT_NOT_VALIDATED',
        message: `Draft must be VALIDATED before submit, current status: ${draft.status}`
      });
    }

    const validationResult = await runValidation(draft.id, { user: req.user });
    const fatalIssues = validationResult.issues.filter((issue) => issue.level === 'FATAL');
    if (fatalIssues.length > 0) {
      return res.status(400).json({
        code: 'FATAL_VALIDATION',
        message: 'Fatal validation issues prevent submit',
        fatal_count: fatalIssues.length,
        issues: validationResult.issues
      });
    }

    await client.query('BEGIN');

    const updatedDraft = await updateDraftState({
      client,
      draftId: draft.id,
      status: DRAFT_STATUS.SUBMITTED,
      ifMatchUpdatedAt
    });

    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'DRAFT_SUBMITTED',
      entityId: draft.id,
      meta: {
        fatal_count: validationResult.fatal_count,
        warn_count: validationResult.warn_count,
        suggest_count: validationResult.suggest_count
      }
    });

    await client.query('COMMIT');

    const receipt = await getReceipt(draft.id);

    return res.json({
      draft_id: draft.id,
      draft: updatedDraft,
      receipt
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/:id/suggestions', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
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
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const suggestions = await listDraftSuggestions(draft.id);
    return res.json({ draft_id: draft.id, suggestions });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/line-items', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const threshold = await fetchReasonThreshold();
    const items = await getLineItems({
      draftId: draft.id,
      uploadId: draft.upload_id,
      threshold,
      unitId: draft.unit_id,
      year: draft.year
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
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const payloadItems = req.body?.items;
    const ifMatchUpdatedAt = parseIfMatchUpdatedAt(req.body?.if_match_updated_at);

    if (!Array.isArray(payloadItems)) {
      throw new AppError({
        statusCode: 400,
        code: 'LINE_ITEMS_INVALID',
        message: 'items must be an array'
      });
    }

    const normalizedItems = payloadItems.map((item) => {
      const itemKey = item?.item_key;
      const isDynamicKey = typeof itemKey === 'string' && itemKey.startsWith('line_item_');
      if (!itemKey || typeof itemKey !== 'string' || (!LINE_ITEM_KEY_SET.has(itemKey) && !isDynamicKey)) {
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
      const fallbackOrder = definition ? definition.order_no : 0;
      const orderNo = item.order_no === undefined || item.order_no === null
        ? fallbackOrder
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

    const updatedDraft = await updateDraftState({
      client,
      draftId: draft.id,
      status: DRAFT_STATUS.DRAFT,
      ifMatchUpdatedAt
    });

    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'DRAFT_EDITED_LINE_ITEMS',
      entityId: draft.id,
      meta: { item_count: normalizedItems.length }
    });

    await client.query('COMMIT');

    const threshold = await fetchReasonThreshold();
    const items = await getLineItems({
      draftId: draft.id,
      uploadId: draft.upload_id,
      threshold,
      unitId: draft.unit_id,
      year: draft.year
    });

    return res.json({
      draft_id: draft.id,
      draft: updatedDraft,
      threshold,
      items,
      preview_text: buildLineItemsPreview(items)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/:id/issues', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const level = req.query.level || null;
    const issues = await fetchIssues(draft.id, level === 'WARN' ? 'WARNING' : level);

    return res.json({
      draft_id: draft.id,
      issues
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/preview', requireAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);

    const validationResult = await runValidation(draft.id, { user: req.user });
    const issues = validationResult.issues;

    const fatalIssues = issues.filter((issue) => issue.level === 'FATAL');
    if (fatalIssues.length > 0) {
      return res.status(400).json({
        code: 'FATAL_VALIDATION',
        message: 'Fatal validation issues prevent report preview generation',
        fatal_count: fatalIssues.length,
        issues
      });
    }

    const previewResult = await generateReportPreview({
      draftId: draft.id,
      userId: req.user.id
    });

    await client.query('BEGIN');
    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'REPORT_PREVIEW_GENERATED',
      entityId: draft.id,
      meta: {
        page_count: previewResult.preflight.pageCount,
        blank_pages: previewResult.preflight.blankPages.length
      }
    });
    await client.query('COMMIT');

    return res.status(201).json({
      draft_id: draft.id,
      preview_ready: true,
      preview_download_url: `/api/drafts/${draft.id}/preview/pdf`,
      preflight: {
        page_count: previewResult.preflight.pageCount,
        blank_pages: previewResult.preflight.blankPages
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/:id/preview/pdf', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const previewPdfPath = getPreviewPdfPath({
      draftId: draft.id,
      userId: req.user.id
    });
    return await sendFileOr404(res, previewPdfPath, 'application/pdf', `draft_${draft.id}_preview.pdf`);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/preview/excel', requireAuth, async (req, res, next) => {
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const previewExcelPath = getPreviewExcelPath({
      draftId: draft.id,
      userId: req.user.id
    });
    return await sendFileOr404(
      res,
      previewExcelPath,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `draft_${draft.id}_preview.xlsx`
    );
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/generate', requireAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const draft = await getDraftWithAccess(req.params.id, req.user);
    const ifMatchUpdatedAt = parseIfMatchUpdatedAt(req.body?.if_match_updated_at);

    if (draft.status !== DRAFT_STATUS.SUBMITTED && draft.status !== DRAFT_STATUS.GENERATED) {
      throw new AppError({
        statusCode: 409,
        code: 'DRAFT_NOT_SUBMITTED',
        message: `Draft must be SUBMITTED before generate, current status: ${draft.status}`
      });
    }

    const validationResult = await runValidation(draft.id, { user: req.user });
    const issues = validationResult.issues;

    const fatalIssues = issues.filter((issue) => issue.level === 'FATAL');
    if (fatalIssues.length > 0) {
      return res.status(400).json({
        code: 'FATAL_VALIDATION',
        message: 'Fatal validation issues prevent report generation',
        fatal_count: fatalIssues.length,
        issues
      });
    }

    const hasPreview = await previewExistsForDraft({
      draftId: draft.id,
      userId: req.user.id
    });
    if (!hasPreview) {
      throw new AppError({
        statusCode: 409,
        code: 'PREVIEW_REQUIRED',
        message: 'Please generate and review preview PDF before publishing final report.'
      });
    }

    const result = await generateReportVersion({
      draftId: draft.id,
      userId: req.user.id
    });

    await client.query('BEGIN');

    const updatedDraft = await updateDraftState({
      client,
      draftId: draft.id,
      status: DRAFT_STATUS.GENERATED,
      ifMatchUpdatedAt
    });

    await appendAuditLog({
      client,
      req,
      userId: req.user.id,
      action: 'REPORT_GENERATED',
      entityId: draft.id,
      meta: {
        report_version_id: result.reportVersionId
      }
    });

    await client.query('COMMIT');

    const receipt = await getReceipt(draft.id);

    return res.status(201).json({
      report_version_id: result.reportVersionId,
      draft: updatedDraft,
      receipt
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
