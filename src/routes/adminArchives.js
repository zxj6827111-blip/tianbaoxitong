const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const db = require('../db');
const {
  resolveHistoryActualKey,
  resolveHistoryActualKeyMeta,
  normalizeText,
  setApprovedAliasMappings
} = require('../services/historyFactMatcher');
const { extractHistoryFactsFromTableData } = require('../services/historyFactAutoExtractor');
const { runArchivePreviewValidation, getEffectiveFieldValue } = require('../services/archiveValidationService');
const { getRequiredHistoryActualKeys } = require('../services/historyActualsConfig');
const { runSelectiveOcrForTables } = require('../services/archiveSelectiveOcrService');
const { sanitizeArchiveTextByCategory } = require('../services/manualTextSanitizer');

const router = express.Router();

const PAGE_MARKER_REGEX = /(?:--\s*PAGE_BREAK\s*--|--\s*\d+\s*of\s*\d+\s*--|--\s*page_number\s*of\s*total_number\s*--)/gi;

const normalizeLine = (line) => line.replace(/\s+/g, ' ').trim();
const normalizeForMatch = (line) => line.replace(/\s+/g, '').trim();

const detectHeading = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const rules = [
    { category: 'FUNCTION', keyword: '主要职能', maxLen: 60 },
    { category: 'STRUCTURE', keyword: '机构设置', maxLen: 60 },
    { category: 'TERMINOLOGY', keyword: '名词解释', maxLen: 40 },
    { category: 'EXPLANATION', keyword: '预算编制说明', maxLen: 80 },
    { category: 'OTHER', keyword: '其他相关情况说明', maxLen: 80 }
  ];

  for (const rule of rules) {
    if (trimmed.includes(rule.keyword) && trimmed.length <= rule.maxLen) {
      return rule;
    }
  }

  return null;
};

const extractSectionsFromText = (text) => {
  const cleaned = text.replace(PAGE_MARKER_REGEX, '');
  const lines = cleaned.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const sections = {};
  let currentCategory = null;

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      currentCategory = heading.category;
      if (!sections[currentCategory]) sections[currentCategory] = [];
      const remainder = line.replace(heading.keyword, '').trim();
      if (remainder) sections[currentCategory].push(remainder);
      continue;
    }

    if (currentCategory) {
      sections[currentCategory].push(line);
    }
  }

  const result = {};
  Object.entries(sections).forEach(([category, contentLines]) => {
    const content = contentLines.join('\n').trim();
    if (content) result[category] = content;
  });

  return result;
};

const sanitizeReusableText = (content, category = null) => {
  if (!content) return '';
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^目录$/.test(line))
    .filter((line) => !/^[一二三四五六七八九十0-9]+[、.．].*[\.。．·…]{6,}\s*$/.test(line))
    .filter((line) => !/^[\.。．·…\-\s]+$/.test(line));
  const normalized = lines.join('\n').trim();
  return sanitizeArchiveTextByCategory(category, normalized);
};

/**
 * Split the EXPLANATION section into structured sub-sections:
 * - EXPLANATION_OVERVIEW: revenue/expenditure summary with year-over-year comparison figures
 * - EXPLANATION_CHANGE_REASON: sentence(s) stating the main reason for changes
 * - EXPLANATION_FISCAL_DETAIL: numbered list of fiscal expenditure items and their purposes
 */
const extractExplanationSubSections = (text) => {
  if (!text) return {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result = {};

  let reasonLineIdx = -1;
  let detailStartIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (reasonLineIdx === -1 && lines[i].includes('主要原因')) {
      reasonLineIdx = i;
    }
    if (lines[i].includes('财政拨款支出主要内容')) {
      detailStartIdx = i;
      break;
    }
  }

  // EXPLANATION_OVERVIEW = everything before the reason line (revenue/expenditure summary)
  const overviewEnd = reasonLineIdx >= 0
    ? reasonLineIdx
    : detailStartIdx >= 0 ? detailStartIdx : -1;
  if (overviewEnd > 0) {
    const overview = lines.slice(0, overviewEnd).join('\n').trim();
    if (overview) result.EXPLANATION_OVERVIEW = overview;
  }

  // EXPLANATION_CHANGE_REASON = the line(s) containing the main reason
  if (reasonLineIdx >= 0) {
    const reasonEnd = detailStartIdx >= 0 ? detailStartIdx : reasonLineIdx + 1;
    const reasonText = lines.slice(reasonLineIdx, reasonEnd).join('\n').trim();
    if (reasonText) result.EXPLANATION_CHANGE_REASON = reasonText;
  }

  // EXPLANATION_FISCAL_DETAIL = from "财政拨款支出主要内容" to end
  if (detailStartIdx >= 0) {
    const detailText = lines.slice(detailStartIdx).join('\n').trim();
    if (detailText) result.EXPLANATION_FISCAL_DETAIL = detailText;
  }

  return result;
};

/**
 * Extract the three-public-expenses sub-section from the OTHER section.
 * Contains year-over-year comparison data and reasons for each expense category.
 */
const extractOtherSubSections = (text) => {
  if (!text) return {};
  const result = {};

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const isHeading = /^[一二三四五六七八九十]+[、．.]/.test(lines[i]);
    if (isHeading && lines[i].includes('三公')) {
      startIdx = i;
    } else if (isHeading && startIdx >= 0) {
      endIdx = i;
      break;
    }
  }

  if (startIdx >= 0) {
    const content = lines.slice(startIdx, endIdx).join('\n').trim();
    if (content) result.OTHER_THREE_PUBLIC = content;
  }

  return result;
};

const detectTableKey = (lines) => {
  const normalizedLines = lines.map(normalizeForMatch);
  const has = (keyword) => normalizedLines.some((line) => line.includes(keyword));
  const findTitle = (keyword) => {
    const match = lines.find((line) => normalizeForMatch(line).includes(keyword));
    return match || null;
  };

  const titleRules = [
    { key: 'budget_summary', keyword: '财务收支预算总表' },
    { key: 'income_summary', keyword: '收入预算总表' },
    { key: 'expenditure_summary', keyword: '支出预算总表' },
    { key: 'fiscal_grant_summary', keyword: '财政拨款收支预算总表' },
    { key: 'general_budget', keyword: '一般公共预算支出功能分类预算表' },
    { key: 'gov_fund_budget', keyword: '政府性基金预算支出功能分类预算表' },
    { key: 'capital_budget', keyword: '国有资本经营预算支出功能分类预算表' },
    { key: 'basic_expenditure', keyword: '一般公共预算基本支出部门预算经济分类预算表' },
    { key: 'three_public', keyword: '三公' }
  ];

  for (const rule of titleRules) {
    if (has(rule.keyword)) {
      return { key: rule.key, title: findTitle(rule.keyword) };
    }
  }

  const rules = [
    { key: 'budget_summary', title: '预算单位财务收支预算总表', keywords: ['本年收入', '本年支出'] },
    { key: 'income_summary', title: '预算单位收入预算总表', keywords: ['收入预算', '功能分类科目名称'] },
    { key: 'expenditure_summary', title: '预算单位支出预算总表', keywords: ['支出预算', '功能分类科目名称'] },
    { key: 'fiscal_grant_summary', title: '预算单位财政拨款收支预算总表', keywords: ['财政拨款收入', '财政拨款支出'] },
    { key: 'general_budget', title: '一般公共预算支出功能分类预算表', keywords: ['一般公共预算支出', '功能分类科目名称'] },
    { key: 'gov_fund_budget', title: '政府性基金预算支出功能分类预算表', keywords: ['政府性基金预算支出'] },
    { key: 'capital_budget', title: '国有资本经营预算支出功能分类预算表', keywords: ['国有资本经营预算支出'] },
    { key: 'basic_expenditure', title: '一般公共预算基本支出经济分类预算表', keywords: ['经济分类科目名称', '一般公共预算基本支出'] },
    { key: 'three_public', title: '“三公”经费和机关运行费预算表', keywords: ['三公', '机关运行'] }
  ];

  for (const rule of rules) {
    if (rule.keywords.every((keyword) => has(keyword))) {
      return rule;
    }
  }

  return { key: 'unknown', title: null };
};

const rowToSignature = (row) => row.map((cell) => String(cell || '').trim()).join('|');
const countNumericTokens = (text) => (String(text || '').match(/[-+]?\d[\d,]*(?:\.\d+)?/g) || []).length;
const isNumericText = (value) => /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(String(value || '').trim());
const compactRowValues = (row) => (Array.isArray(row) ? row : []).map((cell) => String(cell || '').trim()).filter(Boolean);

const isPotentialTableContinuationLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (text.includes('\t')) return true;
  if (/^(?:注[:：]|说明[:：]|备注[:：])/.test(text)) return false;
  if (/^[-—]{2,}$/.test(text)) return false;
  if (/^(?:第?\d+页|page\s*\d+)/i.test(text)) return false;

  if (/^[数]$/.test(text)) return true;
  if (/^[-+]?[\d,./()%]+$/.test(text)) return true;

  if (text.length > 64 && /[。；;]/.test(text)) return false;

  return /(编制部门|单位|项目|科目|编码|合计|总计|小计|预算|支出|收入|类|款|项|三公|机关运行|购置费|运行费|人员经费|公用经费|财政拨款|政府性基金|国有资本|功能分类|经济分类)/.test(text);
};

const NUMERIC_TOKEN_REGEX = /^[-+]?\d[\d,]*(?:\.\d+)?$/;

const parseSpaceSeparatedRow = (text) => {
  const tokens = String(text || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 2) return null;

  const numericCount = tokens.filter((token) => NUMERIC_TOKEN_REGEX.test(token)).length;
  const longTokenCount = tokens.filter((token) => token.length >= 36).length;
  if (longTokenCount > 0) return null;

  if (numericCount >= 2) return tokens;
  if (numericCount === 1 && tokens.length <= 6) return tokens;

  const shortTokenCount = tokens.filter((token) => token.length <= 12).length;
  if (
    numericCount === 0
    && tokens.length >= 3
    && tokens.length <= 10
    && shortTokenCount === tokens.length
  ) {
    return tokens;
  }

  return null;
};

const isLikelyTablessTableLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^(?:--\s*\d+\s*of\s*\d+\s*--|page\s*\d+)/i.test(text)) return false;
  if (/^[-鈥擼]{2,}$/.test(text)) return false;

  const tokens = parseSpaceSeparatedRow(text);
  if (!tokens) return false;

  const numericCount = tokens.filter((token) => NUMERIC_TOKEN_REGEX.test(token)).length;
  if (numericCount >= 2) return true;
  if (numericCount === 1) return tokens.length <= 6;

  const compact = tokens.join('');
  return tokens.length >= 3 && tokens.length <= 8 && compact.length <= 40;
};

const parseTableLineToRow = (line) => {
  const text = String(line || '');
  if (!text.trim()) return null;
  if (text.includes('\t')) {
    return text.split('\t').map((cell) => String(cell || '').trim());
  }
  const spaced = parseSpaceSeparatedRow(text);
  if (spaced) return spaced;
  return [text.trim()];
};

const extractPageRows = (lines) => {
  const tabIndexes = [];
  lines.forEach((line, idx) => {
    if (line.includes('\t')) tabIndexes.push(idx);
  });

  if (tabIndexes.length < 3) {
    const fallbackIndexes = [];
    lines.forEach((line, idx) => {
      if (isLikelyTablessTableLine(line)) {
        fallbackIndexes.push(idx);
      }
    });
    if (fallbackIndexes.length < 3) return [];
    return fallbackIndexes
      .map((lineIndex) => parseTableLineToRow(lines[lineIndex]))
      .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim()));
  }

  const firstTab = tabIndexes[0];
  const lastTab = tabIndexes[tabIndexes.length - 1];
  const selectedIndexes = new Set(tabIndexes);

  for (let i = firstTab; i <= lastTab; i += 1) {
    if (selectedIndexes.has(i)) continue;
    if (isPotentialTableContinuationLine(lines[i])) {
      selectedIndexes.add(i);
    }
  }

  // Include a few likely trailing lines (e.g. "???") right after the last tab row.
  for (let i = lastTab + 1; i < Math.min(lines.length, lastTab + 4); i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (/^(?:note[:：]|说明[:：]|备注[:：])/i.test(line.trim())) break;
    if (isPotentialTableContinuationLine(line)) {
      selectedIndexes.add(i);
      continue;
    }
    break;
  }

  return Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .map((lineIndex) => parseTableLineToRow(lines[lineIndex]))
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim()));
};

const isLikelyCatalogPage = ({ lines, rows }) => {
  const normalizedLines = lines.map(normalizeForMatch);
  const hasCatalogTitle = normalizedLines.some((line) => line === '目录' || line.startsWith('目录'));
  const dottedRows = rows.filter((row) => row.some((cell) => /[\.。．·…]{6,}/.test(String(cell || '')))).length;
  const numericRows = rows.filter((row) => row.some((cell) => countNumericTokens(cell) > 0)).length;
  const mostlyDotted = rows.length > 0 && dottedRows / rows.length >= 0.4;
  const weakNumeric = rows.length > 0 && numericRows / rows.length <= 0.5;
  return hasCatalogTitle || (mostlyDotted && weakNumeric);
};

const isLikelyTableContinuation = ({ rows, previousTable }) => {
  if (!previousTable || !Array.isArray(previousTable.rows) || previousTable.rows.length === 0) return false;
  if (rows.length < 4) return false;

  const prevColCount = previousTable.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const currentColCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const colCountClose = Math.abs(prevColCount - currentColCount) <= 2;

  const numericRows = rows.filter((row) => row.some((cell) => parseNumeric(cell) !== null)).length;
  const headerCellPattern = /^(?:项目|预算数|科目|科目名称|功能分类科目编码|部门预算经济分类科目|经济分类科目名称|合计|总计|小计|类|款|项|本年收入|本年支出|财政拨款收入|财政拨款支出|因公出国(?:\(境\))?费|公务接待费|公务用车购置及运行费|购置费|运行费|机关运行经费预算数|三公经费预算数|收入总计|支出总计|编制部门|编制单位|单位[:：].*)$/;
  const headerHits = rows
    .slice(0, 6)
    .reduce((count, row) => count + row.filter((cell) => headerCellPattern.test(String(cell || '').trim())).length, 0);
  const hasStrongHeaderHint = headerHits >= 2;
  const longSentenceCells = rows
    .slice(0, 8)
    .flat()
    .filter((cell) => {
      const text = String(cell || '').trim();
      return text.length >= 28 && /[。；;]/.test(text);
    }).length;
  const totalCells = rows.slice(0, 8).reduce((sum, row) => sum + row.length, 0);
  const longSentenceRatio = totalCells > 0 ? longSentenceCells / totalCells : 0;

  const numericRatio = rows.length > 0 ? numericRows / rows.length : 0;
  return colCountClose && (numericRatio >= 0.45 || (hasStrongHeaderHint && longSentenceRatio < 0.2));
};

const ordinalTokenPattern = /^\d+(?:\.|\u3001)?$/;
const REVENUE_TOKEN = '\u6536\u5165';
const EXPENDITURE_TOKEN = '\u652f\u51fa';

const mergeLabelParts = (parts) => parts.filter(Boolean).join('');
const containsRevenueToken = (text) => String(text || '').includes(REVENUE_TOKEN);
const containsExpenditureToken = (text) => String(text || '').includes(EXPENDITURE_TOKEN);
const isLikelyExpenditureOnlyLabel = (label) => containsExpenditureToken(label) && !containsRevenueToken(label);
const isLikelyRevenueOnlyLabel = (label) => containsRevenueToken(label) && !containsExpenditureToken(label);

const splitLeftRightLabels = (labelsInput) => {
  const labels = (Array.isArray(labelsInput) ? labelsInput : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (labels.length === 0) return { left: '', right: '' };
  if (labels.length === 1) return { left: labels[0], right: '' };
  if (labels.length === 2) return { left: labels[0], right: labels[1] };
  if (ordinalTokenPattern.test(labels[0])) {
    return {
      left: mergeLabelParts(labels.slice(0, 2)),
      right: mergeLabelParts(labels.slice(2))
    };
  }
  return {
    left: labels[0],
    right: mergeLabelParts(labels.slice(1))
  };
};

const isMetadataRow = (values) => {
  const cells = (Array.isArray(values) ? values : []).filter(Boolean);
  if (cells.length === 0 || cells.length > 2) return false;
  return cells.some((cell) => /[:\uFF1A]/.test(String(cell || '').trim()));
};

const normalizeBudgetSummaryRows = (rowsInput) => {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const output = [];

  for (const row of rows) {
    const rawValues = (Array.isArray(row) ? row : []).map((cell) => String(cell || '').trim());
    const values = compactRowValues(row);
    if (values.length === 0) continue;
    const joined = values.join('');

    // Narrative lines from explanation pages can be accidentally captured as table rows.
    if (joined.length >= 28 && /[。；;]/.test(joined) && values.filter((item) => isNumericText(item)).length <= 1) {
      continue;
    }

    const labels = values.filter((item) => !isNumericText(item));
    const nums = values.filter((item) => isNumericText(item));

    if (isMetadataRow(values)) {
      output.push(values.slice(0, 2));
      continue;
    }

    if (nums.length === 0 && values.length >= 4) {
      output.push(values.slice(0, 4));
      continue;
    }

    const out = ['', '', '', ''];
    const tokens = [...values];
    let leadingOrdinal = '';
    if (ordinalTokenPattern.test(tokens[0] || '')) {
      leadingOrdinal = tokens.shift();
    }

    const firstExpenditureIndex = tokens.findIndex(
      (token) => !isNumericText(token) && isLikelyExpenditureOnlyLabel(token)
    );
    const leftTokens = firstExpenditureIndex >= 0 ? tokens.slice(0, firstExpenditureIndex) : tokens;
    const rightTokens = firstExpenditureIndex >= 0 ? tokens.slice(firstExpenditureIndex) : [];

    const leftLabelRaw = leftTokens.find((token) => !isNumericText(token)) || '';
    const leftLabel = leadingOrdinal && leftLabelRaw
      ? `${leadingOrdinal} ${leftLabelRaw}`
      : (leftLabelRaw || leadingOrdinal);
    const leftNum = leftTokens.find((token) => isNumericText(token)) || '';

    let rightLabel = rightTokens.find((token) => !isNumericText(token)) || '';
    let rightNum = rightTokens.find((token) => isNumericText(token)) || '';

    // Fallback split for rows without explicit left/right expenditure boundary.
    if (!rightLabel && !rightNum && firstExpenditureIndex < 0) {
      const split = splitLeftRightLabels(labels);
      if (!out[0] && split.left) {
        out[0] = leadingOrdinal && !split.left.startsWith(leadingOrdinal)
          ? `${leadingOrdinal} ${split.left}`
          : split.left;
      }
      rightLabel = split.right || '';
      if (!leftNum && nums.length > 0) out[1] = nums[0];
      if (nums.length > 1) rightNum = nums[1];
    }

    if (leftLabel && !out[0]) out[0] = leftLabel;
    if (leftNum && !out[1]) out[1] = leftNum;
    if (rightLabel) out[2] = rightLabel;
    if (rightNum) out[3] = rightNum;

    if (out.some(Boolean)) {
      output.push(out);
    }
  }

  return output;
};

const normalizeFiscalGrantSummaryRows = (rowsInput) => {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const output = [];

  for (const row of rows) {
    const values = compactRowValues(row);
    if (values.length === 0) continue;
    const joined = values.join('');
    const numericCellCount = values.filter((item) => isNumericText(item)).length;
    const strictTableHint = /(编制部门|编制单位|单位[:：]|财政拨款收入|财政拨款支出|收入总计|支出总计|一般公共预算资金|政府性基金预算|政府性基金|国有资本经营预算|预算数|^项目$)/.test(joined);

    // Filter out paragraph-like lines that were merged from explanation sections.
    if (
      (numericCellCount === 0 && !strictTableHint)
      || (joined.length >= 28 && /[。；;]/.test(joined) && numericCellCount <= 1)
      || (/^(?:\d+[.、])/.test(values[0] || '') && joined.length >= 18 && numericCellCount === 0)
      || (/(主要用于|未单独设置|情况说明|实施.*制度)/.test(joined) && numericCellCount <= 1)
    ) {
      continue;
    }

    const labels = values.filter((item) => !isNumericText(item));
    const nums = values.filter((item) => isNumericText(item));

    if (isMetadataRow(values)) {
      output.push(values.slice(0, 2));
      continue;
    }

    if (nums.length === 0 && values.length >= 7) {
      output.push(values.slice(0, 7));
      continue;
    }

    const out = ['', '', '', '', '', '', ''];

    if (labels.length === 1 && nums.length >= 2) {
      const label = labels[0];
      if (isLikelyRevenueOnlyLabel(label)) {
        out[0] = label;
        out[1] = nums[0] || '';
      } else {
        out[2] = label;
        out[3] = nums[0] || '';
        out[4] = nums[1] || '';
        out[5] = nums[2] || '';
        out[6] = nums[3] || '';
      }
      output.push(out);
      continue;
    }

    const { left, right } = splitLeftRightLabels(labels);

    if (nums.length >= 3) {
      out[0] = left;
      out[1] = nums[0];
      out[2] = right;
      out[3] = nums[1] || '';
      out[4] = nums[2] || '';
      out[5] = nums[3] || '';
      out[6] = nums[4] || '';
      output.push(out);
      continue;
    }

    if (nums.length >= 1) {
      if (right) {
        out[0] = left;
        out[2] = right;
        out[3] = nums[0] || '';
        out[4] = nums[1] || '';
        out[5] = nums[2] || '';
        out[6] = nums[3] || '';
      } else if (isLikelyRevenueOnlyLabel(left)) {
        out[0] = left;
        out[1] = nums[0] || '';
      } else {
        out[2] = left;
        out[3] = nums[0] || '';
        out[4] = nums[1] || '';
        out[5] = nums[2] || '';
        out[6] = nums[3] || '';
      }
      output.push(out);
      continue;
    }

    if (right) {
      out[0] = left;
      out[2] = right;
    } else if (isLikelyExpenditureOnlyLabel(left)) {
      out[2] = left;
    } else {
      out[0] = left;
    }
    output.push(out);
  }

  return output;
};

const normalizeThreePublicRows = (rowsInput) => {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const output = [];
  let seenDataRow = false;

  for (const row of rows) {
    const rawValues = Array.isArray(row)
      ? row.map((cell) => String(cell || '').trim())
      : [];
    const values = compactRowValues(rawValues);
    if (values.length === 0) continue;
    const joined = values.join('');
    const numericCount = rawValues.filter((item) => isNumericText(item)).length;
    const headerLike = /(编制部门|编制单位|单位[:：]|三公|机关运行|合计|因公出国|公务接待费|公务用车|小计|购置费|运行费|^数$)/.test(joined);
    const longNarrative = joined.length >= 28 && /[。；;]/.test(joined);

    if (numericCount >= 2) {
      seenDataRow = true;
      if (rawValues.length >= 7) {
        output.push(rawValues.slice(0, 7));
        continue;
      }
      const nums = rawValues.filter((item) => isNumericText(item));
      if (nums.length === 4) {
        output.push([
          nums[0] || '',
          nums[1] || '',
          nums[2] || '',
          '0',
          '0',
          '0',
          nums[3] || ''
        ]);
      } else if (nums.length === 3) {
        output.push([
          nums[0] || '',
          '0',
          nums[1] || '',
          '0',
          '0',
          '0',
          nums[2] || ''
        ]);
      } else {
        output.push(nums.slice(0, 7));
      }
      continue;
    }

    if (!seenDataRow) {
      if (headerLike && !longNarrative) {
        output.push(values.slice(0, 7));
      }
      continue;
    }
  }

  return output.length > 0 ? output : rows;
};

const normalizeRowsByTableKey = (tableKey, rows) => {
  if (tableKey === 'budget_summary') return normalizeBudgetSummaryRows(rows);
  if (tableKey === 'fiscal_grant_summary') return normalizeFiscalGrantSummaryRows(rows);
  if (tableKey === 'three_public') return normalizeThreePublicRows(rows);
  return rows;
};

const appendRows = (table, rows, { continuation = false } = {}) => {
  const seen = new Set((table.rows || []).map((row) => rowToSignature(row)));
  rows.forEach((row, idx) => {
    if (!Array.isArray(row) || row.length === 0) return;
    const signature = rowToSignature(row);
    if (!signature) return;
    if (continuation && idx < 4 && seen.has(signature)) {
      return;
    }
    table.rows.push(row);
    seen.add(signature);
  });
};

const extractTablesFromText = (text) => {
  const pages = text.split(PAGE_MARKER_REGEX);
  const tablesByKey = new Map();
  const unknownTables = [];
  let lastKnownKey = null;

  pages.forEach((pageText, idx) => {
    const lines = pageText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rows = extractPageRows(lines);
    if (rows.length < 3) return;

    const { key, title } = detectTableKey(lines);

    if (isLikelyCatalogPage({ lines, rows })) {
      return;
    }

    const pageNo = idx + 1;
    const knownKey = key !== 'unknown' ? key : null;
    const hasNumericCells = rows.some((row) => Array.isArray(row) && row.some((cell) => parseNumeric(cell) !== null));
    if (knownKey && !hasNumericCells) {
      const hasHeaderHint = lines.some((line) => /(项目|预算数|功能分类科目|财政拨款收入|财政拨款支出|一般公共预算|政府性基金预算|国有资本经营预算|三公|机关运行|单位[:：]|编制部门)/.test(line));
      const narrativeLineCount = lines.filter((line) => line.length >= 18 && /[。；]/.test(line)).length;
      if (!hasHeaderHint || narrativeLineCount >= 2) {
        return;
      }
    }
    let targetKey = knownKey;
    if (!targetKey && lastKnownKey && isLikelyTableContinuation({ rows, previousTable: tablesByKey.get(lastKnownKey) })) {
      targetKey = lastKnownKey;
    }

    if (!targetKey) {
      unknownTables.push({
        table_key: `unknown_page_${pageNo}`,
        table_title: title,
        page_numbers: [pageNo],
        rows
      });
      return;
    }

    const existing = tablesByKey.get(targetKey) || {
      table_key: targetKey,
      table_title: title,
      page_numbers: [],
      rows: []
    };

    if (!existing.table_title && title) {
      existing.table_title = title;
    }
    if (!existing.page_numbers.includes(pageNo)) {
      existing.page_numbers.push(pageNo);
    }
    appendRows(existing, rows, {
      continuation: Boolean(!knownKey && lastKnownKey && targetKey === lastKnownKey)
    });
    tablesByKey.set(targetKey, existing);

    if (knownKey) {
      lastKnownKey = knownKey;
    }
  });

  const finalTables = [
    ...Array.from(tablesByKey.values()),
    ...unknownTables
  ];
  return finalTables.map((table) => {
    const tableRows = normalizeRowsByTableKey(table.table_key, table.rows);
    const minColCount = table.table_key === 'three_public' ? 7 : 0;
    const colCount = Math.max(
      minColCount,
      tableRows.reduce((max, row) => Math.max(max, row.length), 0)
    );
    const normalizedRows = tableRows.map((row) => {
      const source = Array.isArray(row) ? row : [];
      return Array.from({ length: colCount }, (_, index) => {
        const cell = source[index];
        return cell === null || cell === undefined ? '' : String(cell).trim();
      });
    });
    return {
      table_key: table.table_key,
      table_title: table.table_title,
      page_numbers: (table.page_numbers || []).sort((a, b) => a - b),
      row_count: normalizedRows.length,
      col_count: colCount,
      rows: normalizedRows
    };
  });
};

const VALUE_COLUMNS_BY_TABLE = {
  income_summary: ['total', 'fiscal', 'business', 'operation', 'other'],
  expenditure_summary: ['total', 'basic', 'project'],
  general_budget: ['total', 'basic', 'project'],
  gov_fund_budget: ['total', 'basic', 'project'],
  capital_budget: ['total', 'basic', 'project'],
  basic_expenditure: ['total', 'personnel', 'public']
};

const LOCAL_PARSE_LABEL_BY_KEY = {
  budget_revenue_total: '收入总计',
  budget_revenue_fiscal: '财政拨款收入',
  budget_revenue_business: '事业收入',
  budget_revenue_operation: '事业单位经营收入',
  budget_revenue_other: '其他收入',
  budget_expenditure_total: '支出总计',
  budget_expenditure_basic: '基本支出',
  budget_expenditure_project: '项目支出',
  fiscal_grant_revenue_total: '财政拨款收入合计',
  fiscal_grant_expenditure_total: '财政拨款支出合计',
  fiscal_grant_expenditure_general: '一般公共预算财政拨款支出',
  fiscal_grant_expenditure_gov_fund: '政府性基金预算财政拨款支出',
  fiscal_grant_expenditure_capital: '国有资本经营预算财政拨款支出',
  three_public_total: '三公经费合计',
  three_public_outbound: '因公出国（境）费',
  three_public_vehicle_total: '公务用车购置及运行费',
  three_public_vehicle_purchase: '公务用车购置费',
  three_public_vehicle_operation: '公务用车运行费',
  three_public_reception: '公务接待费',
  operation_fund: '机关运行经费预算数'
};

const LOCAL_PARSE_KEY_ORDER = [
  'budget_revenue_total',
  'budget_revenue_fiscal',
  'budget_revenue_business',
  'budget_revenue_operation',
  'budget_revenue_other',
  'budget_expenditure_total',
  'budget_expenditure_basic',
  'budget_expenditure_project',
  'fiscal_grant_revenue_total',
  'fiscal_grant_expenditure_total',
  'fiscal_grant_expenditure_general',
  'fiscal_grant_expenditure_gov_fund',
  'fiscal_grant_expenditure_capital',
  'three_public_total',
  'three_public_outbound',
  'three_public_reception',
  'three_public_vehicle_total',
  'three_public_vehicle_purchase',
  'three_public_vehicle_operation',
  'operation_fund'
];

const FACT_KEY_TO_TABLE_KEY = {
  budget_revenue_total: 'budget_summary',
  budget_revenue_fiscal: 'budget_summary',
  budget_revenue_business: 'income_summary',
  budget_revenue_operation: 'income_summary',
  budget_revenue_other: 'income_summary',
  budget_expenditure_total: 'budget_summary',
  budget_expenditure_basic: 'expenditure_summary',
  budget_expenditure_project: 'expenditure_summary',
  fiscal_grant_revenue_total: 'fiscal_grant_summary',
  fiscal_grant_expenditure_total: 'fiscal_grant_summary',
  fiscal_grant_expenditure_general: 'fiscal_grant_summary',
  fiscal_grant_expenditure_gov_fund: 'fiscal_grant_summary',
  fiscal_grant_expenditure_capital: 'fiscal_grant_summary',
  three_public_total: 'three_public',
  three_public_outbound: 'three_public',
  three_public_vehicle_total: 'three_public',
  three_public_vehicle_purchase: 'three_public',
  three_public_vehicle_operation: 'three_public',
  three_public_reception: 'three_public',
  operation_fund: 'three_public'
};

const buildLocalParsedItemsFromAutoFacts = (autoFacts) => {
  const orderedKeys = Array.from(new Set([
    ...LOCAL_PARSE_KEY_ORDER,
    ...getRequiredHistoryActualKeys(),
    ...Object.keys(autoFacts || {})
  ]));
  const items = [];
  for (const key of orderedKeys) {
    const value = Number(autoFacts?.[key]);
    if (!Number.isFinite(value)) continue;
    items.push({
      key: LOCAL_PARSE_LABEL_BY_KEY[key] || key,
      value: roundToFactPrecision(value)
    });
  }
  return items;
};

const parseNumeric = (value) => {
  if (!value) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const NUMERIC_COMPARE_TOLERANCE = 0.01;
const valuesNearlyEqual = (left, right, tolerance = NUMERIC_COMPARE_TOLERANCE) => {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= tolerance;
};

const isLikelyUnitScaleMismatch = (autoValue, manualValue) => {
  if (!Number.isFinite(autoValue) || !Number.isFinite(manualValue) || autoValue === 0) return false;
  const ratio = Math.abs(manualValue / autoValue);
  return Math.abs(ratio - 10000) <= 1 || Math.abs(ratio - 0.0001) <= 0.000001;
};

const roundToFactPrecision = (value) => {
  if (!Number.isFinite(value)) return value;
  return Number(Number(value).toFixed(2));
};

const MANUAL_VALUE_AMBIGUOUS_YUAN_THRESHOLD = 10000000;
const MANUAL_SCALE_ANCHOR_MAP = {
  budget_revenue_fiscal: 'fiscal_grant_revenue_total',
  fiscal_grant_revenue_total: 'budget_revenue_fiscal',
  budget_expenditure_total: 'fiscal_grant_expenditure_total',
  fiscal_grant_expenditure_total: 'budget_expenditure_total'
};
const SMALL_AMOUNT_FACT_KEYS = new Set([
  'three_public_total',
  'three_public_outbound',
  'three_public_vehicle_total',
  'three_public_vehicle_purchase',
  'three_public_vehicle_operation',
  'three_public_reception',
  'operation_fund'
]);

const inferManualScaleToWanyuan = (rawLabel, numeric) => {
  const text = String(rawLabel || '').replace(/\s+/g, '');
  if (!text) {
    return Math.abs(numeric) >= MANUAL_VALUE_AMBIGUOUS_YUAN_THRESHOLD ? 1 / 10000 : 1;
  }

  if (text.includes('万元')) return 1;
  if (text.includes('千元')) return 0.1;
  if (text.includes('单位：元') || text.includes('单位:元')) return 1 / 10000;
  if (text.includes('元') && !text.includes('美元')) return 1 / 10000;
  if (Math.abs(numeric) >= MANUAL_VALUE_AMBIGUOUS_YUAN_THRESHOLD) return 1 / 10000;
  return 1;
};

const normalizeManualFactValue = ({ rawLabel, matchedKey, numeric, mappedEntries }) => {
  const anchorKey = MANUAL_SCALE_ANCHOR_MAP[matchedKey];
  if (anchorKey) {
    const anchor = Number(mappedEntries.get(anchorKey));
    if (Number.isFinite(anchor) && anchor !== 0 && isLikelyUnitScaleMismatch(anchor, numeric)) {
      const ratio = Math.abs(numeric / anchor);
      const normalized = ratio >= 1 ? numeric / 10000 : numeric * 10000;
      return {
        value: roundToFactPrecision(normalized),
        normalized: true,
        reason: 'ANCHOR_SCALE_NORMALIZED'
      };
    }
  }

  const scale = inferManualScaleToWanyuan(rawLabel, numeric);
  if (scale !== 1) {
    return {
      value: roundToFactPrecision(numeric * scale),
      normalized: true,
      reason: 'LABEL_OR_MAGNITUDE_SCALE_NORMALIZED'
    };
  }

  // Guardrail: three-public and operation-fund values are in "万元" and are usually small.
  // If manual parse yields huge numbers (often "元"), normalize to "万元".
  if (SMALL_AMOUNT_FACT_KEYS.has(matchedKey) && Math.abs(numeric) >= 1000) {
    return {
      value: roundToFactPrecision(numeric / 10000),
      normalized: true,
      reason: 'SMALL_AMOUNT_KEY_SCALE_NORMALIZED'
    };
  }

  return {
    value: roundToFactPrecision(numeric),
    normalized: false,
    reason: null
  };
};

const PREVIEW_BATCH_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  REVIEWED: 'REVIEWED',
  COMMITTED: 'COMMITTED',
  REJECTED: 'REJECTED'
};

const PREVIEW_CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNRECOGNIZED: 'UNRECOGNIZED'
};

const OCR_TRACE_RULE_ID = 'ARCHIVE.OCR_TRACE';

const LOW_CONFIDENCE_SET = new Set([
  PREVIEW_CONFIDENCE.LOW,
  PREVIEW_CONFIDENCE.UNRECOGNIZED
]);

const toFactNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
};

const resolveTargetUnitId = async ({ client, report, inputUnitId }) => {
  if (inputUnitId) {
    const unitCheck = await client.query(
      `SELECT id
       FROM org_unit
       WHERE id = $1
         AND department_id = $2`,
      [inputUnitId, report.department_id]
    );
    if (unitCheck.rowCount === 0) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'unit_id does not belong to report department'
      });
    }
    return inputUnitId;
  }

  const fallbackUnit = await client.query(
    `SELECT id
     FROM org_unit
     WHERE department_id = $1
     ORDER BY sort_order ASC, created_at ASC
     LIMIT 1`,
    [report.department_id]
  );
  if (fallbackUnit.rowCount === 0) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'No unit found for report department'
    });
  }
  return fallbackUnit.rows[0].id;
};

const loadApprovedAliasMappings = async (client) => {
  try {
    const aliasResult = await client.query(
      `SELECT raw_label, normalized_label, resolved_key
       FROM custom_alias_mapping
       WHERE status = 'APPROVED'`
    );
    setApprovedAliasMappings(aliasResult.rows);
    return aliasResult.rowCount;
  } catch (error) {
    // Migration may not exist in some environments yet.
    if (error.code === '42P01') {
      setApprovedAliasMappings([]);
      return 0;
    }
    throw error;
  }
};

const createPreviewIssue = (rule_id, level, message, evidence = null) => ({
  rule_id,
  level,
  message,
  evidence
});

const normalizeIssueText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const RAW_TEXT_ITEM_REGEX = /^(.+?)\s+([-+]?[\d,]+\.?\d*)$/;
const MATCH_CONFIDENCE_SCORE = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNRECOGNIZED: 0
};
const RAW_CHANNEL_CONSISTENCY_TOLERANCE = 0.05;

const extractRawTextFallbackItems = (rawText) => {
  const lines = String(rawText || '').split('\n');
  const items = [];
  const dedupe = new Set();

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    const match = trimmed.match(RAW_TEXT_ITEM_REGEX);
    if (!match) continue;

    const key = normalizeIssueText(match[1]);
    const valueStr = String(match[2] || '').replace(/,/g, '');
    const value = parseFloat(valueStr);

    if (!Number.isFinite(value)) continue;
    if (key.length < 2 || key.length > 80) continue;
    if (isLikelyNoisyLabel(key)) continue;

    const embeddedNumbers = countNumericTokens(key);
    if (embeddedNumbers >= 2) continue;

    const dedupeKey = `${normalizeText(key)}|${roundToFactPrecision(value)}`;
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);
    items.push({ key, value: roundToFactPrecision(value) });
  }

  return items;
};

const chooseBetterRawChannelCandidate = (existing, candidate) => {
  if (!existing) return candidate;
  const existingScore = MATCH_CONFIDENCE_SCORE[existing.confidence] || 0;
  const candidateScore = MATCH_CONFIDENCE_SCORE[candidate.confidence] || 0;
  if (candidateScore > existingScore) return candidate;
  return existing;
};

const buildRawTextChannelFacts = ({ rawText, mappedEntries }) => {
  const channelItems = extractRawTextFallbackItems(rawText);
  const facts = new Map();

  for (const item of channelItems) {
    const rawLabel = normalizeIssueText(item?.key);
    const numeric = Number(item?.value);
    if (!rawLabel || !Number.isFinite(numeric)) continue;

    const match = resolveHistoryActualKeyMetaByCandidates(rawLabel);
    if (!match.key) continue;

    const normalized = normalizeManualFactValue({
      rawLabel,
      matchedKey: match.key,
      numeric,
      mappedEntries
    });
    const value = toFactNumber(normalized.value);
    if (value === null) continue;

    const candidate = {
      key: match.key,
      value,
      raw_label: rawLabel,
      confidence: match.confidence || PREVIEW_CONFIDENCE.MEDIUM,
      match_source: match.source || 'RAW_TEXT_RULE',
      normalize_reason: normalized.reason || null
    };
    facts.set(match.key, chooseBetterRawChannelCandidate(facts.get(match.key), candidate));
  }

  return {
    itemCount: channelItems.length,
    matchedCount: facts.size,
    facts
  };
};

const detectSuspiciousTableKeys = ({ autoFacts, rawChannelFacts }) => {
  const suspicious = new Set();
  const structured = autoFacts && typeof autoFacts === 'object' ? autoFacts : {};
  const rawFacts = rawChannelFacts?.facts instanceof Map ? rawChannelFacts.facts : new Map();

  for (const key of getRequiredHistoryActualKeys()) {
    const autoValue = toFactNumber(structured[key]);
    if (autoValue !== null) continue;
    const tableKey = FACT_KEY_TO_TABLE_KEY[key];
    if (tableKey) suspicious.add(tableKey);
  }

  for (const [key, rawFact] of rawFacts.entries()) {
    const autoValue = toFactNumber(structured[key]);
    const rawValue = toFactNumber(rawFact?.value);
    if (autoValue === null || rawValue === null) continue;
    if (!valuesNearlyEqual(autoValue, rawValue, RAW_CHANNEL_CONSISTENCY_TOLERANCE)) {
      const tableKey = FACT_KEY_TO_TABLE_KEY[key];
      if (tableKey) suspicious.add(tableKey);
    }
  }

  return Array.from(suspicious);
};

const appendMatchSourceTag = (matchSource, tag) => {
  const current = String(matchSource || '').trim();
  if (!current) return tag;
  if (current.includes(tag)) return current;
  return `${current}|${tag}`;
};

const normalizeLabelCandidates = (rawLabel) => {
  const base = normalizeIssueText(rawLabel);
  if (!base) return [];

  const candidates = [base];
  const pushCandidate = (value) => {
    const text = normalizeIssueText(value);
    if (!text || candidates.includes(text)) return;
    candidates.push(text);
  };

  const withoutBullet = base.replace(/^[\-–—•·*]+\s*/, '');
  pushCandidate(withoutBullet);

  const withoutOrdinal = withoutBullet.replace(/^[（(]?[一二三四五六七八九十百零\d]+[）).、．\s]+/, '');
  pushCandidate(withoutOrdinal);

  const withoutLeadingMarker = withoutOrdinal.replace(/^(?:其中|其|一是|二是|三是|四是)[:：]/, '');
  pushCandidate(withoutLeadingMarker);

  // Some manual labels are extracted as "<label> <amount>".
  const withoutAmountSuffix = withoutLeadingMarker.replace(
    /[：:\s]*[-+]?\d[\d,]*(?:\.\d+)?(?:万元|万?元)?\s*$/,
    ''
  );
  pushCandidate(withoutAmountSuffix);

  return candidates;
};

const resolveHistoryActualKeyMetaByCandidates = (rawLabel) => {
  const candidates = normalizeLabelCandidates(rawLabel);
  for (const candidate of candidates) {
    const match = resolveHistoryActualKeyMeta(candidate);
    if (match.key) {
      return {
        ...match,
        matched_label: candidate
      };
    }
  }
  const normalizedFallback = normalizeText(candidates[0] || rawLabel);
  return {
    key: null,
    source: null,
    confidence: 'UNRECOGNIZED',
    normalized_label: normalizedFallback,
    matched_label: null
  };
};

const isLikelyNoisyLabel = (label) => {
  const text = normalizeIssueText(label);
  const compact = text.replace(/\s+/g, '');
  const compactWithoutAmount = compact.replace(/[-+]?\d[\d,]*(?:\.\d+)?(?:万元|万?元)?$/, '');
  if (!compact) return true;
  if (/[\.。．·…]{6,}/.test(text)) return true;
  if (/^(?:目录|目次)$/.test(compact)) return true;
  if (/^[-+]?[\d,./]+$/.test(compact)) return true;
  if (/^(?:\u5408\u8ba1|\u603b\u8ba1|\u5c0f\u8ba1)\s*[-+]?\d[\d,]*(?:\.\d+)?$/.test(compact)) return true;
  if (/^(?:合计|总计|小计)$/.test(compact)) return true;
  if (/^(?:[一二三四五六七八九十百零]+[、.．]|[0-9]+[、.．]).*(?:支出|收入|预算)$/.test(compactWithoutAmount)) return true;

  const numericCount = countNumericTokens(text);
  const cjkCount = (compact.match(/[\u4E00-\u9FFF]/g) || []).length;
  const alphaCount = (compact.match(/[A-Za-z]/g) || []).length;
  if (numericCount >= 2 && cjkCount <= 2 && alphaCount <= 2) return true;

  return false;
};

const MAX_UNMATCHED_ISSUES_PER_BATCH = 40;
const sanitizePreviewIssues = (issuesInput) => {
  const issues = Array.isArray(issuesInput) ? issuesInput : [];
  const sanitized = [];
  const dedupe = new Set();
  let unmatchedCount = 0;

  for (const issue of issues) {
    if (!issue) continue;
    const ruleId = String(issue.rule_id || '');
    const message = normalizeIssueText(issue.message);
    const evidence = issue.evidence && typeof issue.evidence === 'object' ? issue.evidence : null;

    if (ruleId === OCR_TRACE_RULE_ID) {
      continue;
    }

    if (ruleId === 'ARCHIVE.UNMATCHED_LABEL') {
      const rawLabel = normalizeIssueText(
        evidence?.raw_label || message.replace(/^未匹配字段标签[:：]\s*/i, '')
      );
      if (!rawLabel || isLikelyNoisyLabel(rawLabel)) {
        continue;
      }
      if (unmatchedCount >= MAX_UNMATCHED_ISSUES_PER_BATCH) {
        continue;
      }
      unmatchedCount += 1;
    }

    const dedupeKey = `${ruleId}|${issue.level}|${message}|${JSON.stringify(evidence || {})}`;
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);
    sanitized.push(issue);
  }

  return sanitized;
};

const normalizeOcrSummary = (summaryInput) => {
  const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
  const skipped = Array.isArray(summary.skipped_tables)
    ? summary.skipped_tables.filter((item) => item && typeof item === 'object')
    : [];

  return {
    enabled: Boolean(summary.enabled),
    executed: Boolean(summary.executed),
    reason: summary.reason ? String(summary.reason) : null,
    suspicious_table_keys: Array.isArray(summary.suspicious_table_keys)
      ? summary.suspicious_table_keys.filter(Boolean).map((item) => String(item))
      : [],
    processed_tables: Array.isArray(summary.processed_tables)
      ? summary.processed_tables.filter(Boolean).map((item) => String(item))
      : [],
    skipped_tables: skipped.map((item) => ({
      table_key: item.table_key ? String(item.table_key) : null,
      reason: item.reason ? String(item.reason) : null,
      page_no: Number.isInteger(Number(item.page_no)) ? Number(item.page_no) : null
    })),
    matched_count: Number.isFinite(Number(summary.matched_count))
      ? Number(summary.matched_count)
      : 0,
    mock_mode: Boolean(summary.mock_mode)
  };
};

const extractOcrSummaryFromIssues = (issuesInput) => {
  const issues = Array.isArray(issuesInput) ? issuesInput : [];
  const traceIssue = issues.find((issue) => String(issue?.rule_id || '') === OCR_TRACE_RULE_ID);
  if (!traceIssue) return null;
  return normalizeOcrSummary(traceIssue.evidence);
};

const buildPreviewFields = ({ autoFacts, items, rawChannelFacts, ocrChannelFacts }) => {
  const fields = new Map();
  const issues = [];
  const requiredKeys = new Set(getRequiredHistoryActualKeys());
  const unmatchedLabels = new Set();
  const reconciliationSummary = {
    raw_item_count: Number(rawChannelFacts?.itemCount || 0),
    raw_matched_count: Number(rawChannelFacts?.matchedCount || 0),
    ocr_item_count: Number(ocrChannelFacts?.itemCount || 0),
    ocr_matched_count: Number(ocrChannelFacts?.matchedCount || 0),
    structured_verified: 0,
    ocr_verified: 0,
    ocr_conflicted: 0,
    structured_conflicted: 0,
    structured_only: 0,
    ocr_only: 0,
    raw_only: 0
  };

  for (const [key, value] of Object.entries(autoFacts || {})) {
    const numeric = toFactNumber(value);
    if (numeric === null) continue;
    fields.set(key, {
      key,
      raw_value: null,
      normalized_value: numeric,
      confidence: PREVIEW_CONFIDENCE.HIGH,
      match_source: 'STRUCTURED_TABLE',
      raw_text_snippet: '[AUTO] structured table extraction',
      confirmed: true,
      corrected_value: null
    });
    requiredKeys.delete(key);
  }

  const rawFacts = rawChannelFacts?.facts instanceof Map
    ? new Map(rawChannelFacts.facts)
    : new Map();
  const ocrFacts = ocrChannelFacts?.facts instanceof Map
    ? new Map(ocrChannelFacts.facts)
    : new Map();

  for (const [key, field] of fields.entries()) {
    const autoValue = toFactNumber(field.normalized_value);
    const ocrFact = ocrFacts.get(key);
    const rawFact = rawFacts.get(key);

    if (ocrFact) {
      const ocrValue = toFactNumber(ocrFact.value);
      ocrFacts.delete(key);
      if (rawFact) rawFacts.delete(key);

      if (
        autoValue !== null
        && ocrValue !== null
        && valuesNearlyEqual(autoValue, ocrValue, RAW_CHANNEL_CONSISTENCY_TOLERANCE)
      ) {
        field.match_source = appendMatchSourceTag(field.match_source, 'OCR_AGREE');
        reconciliationSummary.ocr_verified += 1;
        reconciliationSummary.structured_verified += 1;
        continue;
      }

      field.confidence = PREVIEW_CONFIDENCE.LOW;
      field.confirmed = false;
      field.match_source = appendMatchSourceTag(field.match_source, 'OCR_CONFLICT');
      reconciliationSummary.ocr_conflicted += 1;
      reconciliationSummary.structured_conflicted += 1;
      issues.push(createPreviewIssue(
        'ARCHIVE.OCR_RECHECK_CONFLICT',
        'WARN',
        `OCR重提与结构化提取冲突：${key}`,
        {
          key,
          structured_value: autoValue,
          ocr_value: ocrValue,
          ocr_label: ocrFact.raw_label,
          ocr_match_source: ocrFact.match_source,
          tolerance: RAW_CHANNEL_CONSISTENCY_TOLERANCE
        }
      ));
      continue;
    }

    if (!rawFact) {
      reconciliationSummary.structured_only += 1;
      continue;
    }

    const rawValue = toFactNumber(rawFact.value);
    rawFacts.delete(key);

    if (
      autoValue !== null
      && rawValue !== null
      && valuesNearlyEqual(autoValue, rawValue, RAW_CHANNEL_CONSISTENCY_TOLERANCE)
    ) {
      field.match_source = appendMatchSourceTag(field.match_source, 'RAW_TEXT_AGREE');
      reconciliationSummary.structured_verified += 1;
      continue;
    }

    field.confidence = PREVIEW_CONFIDENCE.LOW;
    field.confirmed = false;
    field.match_source = appendMatchSourceTag(field.match_source, 'RAW_TEXT_CONFLICT');
    reconciliationSummary.structured_conflicted += 1;
    issues.push(createPreviewIssue(
      'ARCHIVE.DUAL_SOURCE_CONFLICT',
      'WARN',
      `双通道数值冲突：${key}`,
      {
        key,
        structured_value: autoValue,
        raw_text_value: rawValue,
        raw_label: rawFact.raw_label,
        raw_match_source: rawFact.match_source,
        tolerance: RAW_CHANNEL_CONSISTENCY_TOLERANCE
      }
    ));
  }

  for (const [key, ocrFact] of ocrFacts.entries()) {
    if (fields.has(key)) continue;
    fields.set(key, {
      key,
      raw_value: String(ocrFact.value),
      normalized_value: toFactNumber(ocrFact.value),
      confidence: PREVIEW_CONFIDENCE.LOW,
      match_source: appendMatchSourceTag(ocrFact.match_source || 'OCR_RULE', 'OCR_ONLY'),
      raw_text_snippet: ocrFact.raw_label || null,
      confirmed: false,
      corrected_value: null
    });
    requiredKeys.delete(key);
    reconciliationSummary.ocr_only += 1;
  }

  for (const [key, rawFact] of rawFacts.entries()) {
    if (fields.has(key)) continue;
    fields.set(key, {
      key,
      raw_value: String(rawFact.value),
      normalized_value: toFactNumber(rawFact.value),
      confidence: PREVIEW_CONFIDENCE.LOW,
      match_source: appendMatchSourceTag(rawFact.match_source || 'RAW_TEXT_RULE', 'RAW_TEXT_ONLY'),
      raw_text_snippet: rawFact.raw_label || null,
      confirmed: false,
      corrected_value: null
    });
    requiredKeys.delete(key);
    reconciliationSummary.raw_only += 1;
  }

  for (const item of items || []) {
    const rawLabel = normalizeIssueText(item?.key);
    const numeric = Number(item?.value);
    if (!rawLabel || !Number.isFinite(numeric)) continue;

    const match = resolveHistoryActualKeyMetaByCandidates(rawLabel);
    if (!match.key) {
      if (isLikelyNoisyLabel(rawLabel)) {
        continue;
      }
      const normalizedLabel = normalizeText(rawLabel);
      if (unmatchedLabels.has(normalizedLabel)) {
        continue;
      }
      unmatchedLabels.add(normalizedLabel);
      issues.push(createPreviewIssue(
        'ARCHIVE.UNMATCHED_LABEL',
        'WARN',
        `未匹配字段标签：${rawLabel}`,
        { raw_label: rawLabel, normalized_label: match.normalized_label || normalizedLabel }
      ));
      continue;
    }

    if (fields.has(match.key)) {
      const autoValue = toFactNumber(fields.get(match.key).normalized_value);
      const normalizedConflictManual = normalizeManualFactValue({
        rawLabel,
        matchedKey: match.key,
        numeric,
        mappedEntries: new Map(Array.from(fields.entries()).map(([key, field]) => [key, field.normalized_value]))
      });
      let comparableManualValue = toFactNumber(normalizedConflictManual.value);
      let normalizeReason = normalizedConflictManual.reason;
      if (
        autoValue !== null
        && comparableManualValue !== null
        && !valuesNearlyEqual(autoValue, comparableManualValue)
        && isLikelyUnitScaleMismatch(autoValue, numeric)
      ) {
        const ratio = Math.abs(numeric / autoValue);
        const scaled = ratio >= 1 ? numeric / 10000 : numeric * 10000;
        comparableManualValue = toFactNumber(roundToFactPrecision(scaled));
        normalizeReason = normalizeReason || 'AUTO_VALUE_SCALE_NORMALIZED';
      }
      if (
        autoValue !== null
        && comparableManualValue !== null
        && !valuesNearlyEqual(autoValue, comparableManualValue)
      ) {
        issues.push(createPreviewIssue(
          'ARCHIVE.MANUAL_CONFLICT',
          'WARN',
          `手工解析值与结构化结果冲突：${match.key}`,
          {
            key: match.key,
            auto_value: autoValue,
            manual_value: numeric,
            normalized_manual_value: comparableManualValue,
            normalize_reason: normalizeReason,
            raw_label: rawLabel
          }
        ));
      }
      continue;
    }

    const normalizedManual = normalizeManualFactValue({
      rawLabel,
      matchedKey: match.key,
      numeric,
      mappedEntries: new Map(Array.from(fields.entries()).map(([key, field]) => [key, field.normalized_value]))
    });

    const normalizedValue = toFactNumber(normalizedManual.value);
    fields.set(match.key, {
      key: match.key,
      raw_value: String(numeric),
      normalized_value: normalizedValue,
      confidence: match.confidence || PREVIEW_CONFIDENCE.MEDIUM,
      match_source: match.source || 'FUZZY_RULE',
      raw_text_snippet: rawLabel,
      confirmed: false,
      corrected_value: null
    });
    requiredKeys.delete(match.key);
  }

  for (const key of requiredKeys) {
    if (!fields.has(key)) {
      fields.set(key, {
        key,
        raw_value: null,
        normalized_value: null,
        confidence: PREVIEW_CONFIDENCE.UNRECOGNIZED,
        match_source: null,
        raw_text_snippet: null,
        confirmed: false,
        corrected_value: null
      });
    }
  }

  return {
    fields: Array.from(fields.values()).sort((a, b) => a.key.localeCompare(b.key)),
    issues,
    reconciliationSummary
  };
};

const ARCHIVE_VALIDATION_RULE_IDS = new Set([
  'ARCHIVE.FIELD_COVERAGE',
  'ARCHIVE.BALANCE_REVENUE_EXPENDITURE',
  'ARCHIVE.BALANCE_EXPENDITURE_COMPONENTS',
  'ARCHIVE.BALANCE_FISCAL_GRANT',
  'ARCHIVE.YOY_ANOMALY'
]);

const refreshArchiveValidationIssues = async ({ client, batchId, unitId, year, fields }) => {
  const issues = await runArchivePreviewValidation({ unitId, year, fields });
  await client.query(
    `DELETE FROM archive_preview_issue
     WHERE batch_id = $1
       AND rule_id = ANY($2)`,
    [batchId, Array.from(ARCHIVE_VALIDATION_RULE_IDS)]
  );
  for (const issue of issues) {
    await client.query(
      `INSERT INTO archive_preview_issue
         (batch_id, rule_id, level, message, evidence)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        batchId,
        issue.rule_id,
        issue.level,
        issue.message,
        issue.evidence ? JSON.stringify(issue.evidence) : null
      ]
    );
  }
  return issues;
};

const createPreviewBatch = async ({ client, report, targetUnitId, items, userId }) => {
  const rawTextResult = await client.query(
    `SELECT content_text
     FROM org_dept_text_content
     WHERE source_report_id = $1 AND category = 'RAW'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [report.id]
  );
  const rawText = rawTextResult.rows[0]?.content_text || null;

  const tableDataRes = await client.query(
    `SELECT table_key, table_title, page_numbers, data_json
     FROM org_dept_table_data
     WHERE report_id = $1`,
    [report.id]
  );
  const tableRows = tableDataRes.rows || [];
  const autoFacts = extractHistoryFactsFromTableData(tableRows);
  const rawChannelFacts = buildRawTextChannelFacts({
    rawText,
    mappedEntries: new Map(Object.entries(autoFacts || {}))
  });
  const suspiciousTableKeys = detectSuspiciousTableKeys({
    autoFacts,
    rawChannelFacts
  });
  const ocrResult = await runSelectiveOcrForTables({
    pdfPath: report.file_path,
    tables: tableRows,
    suspiciousTableKeys
  });
  const ocrText = Object.values(ocrResult?.table_text_by_key || {}).join('\n').trim();
  const ocrChannelFacts = buildRawTextChannelFacts({
    rawText: ocrText,
    mappedEntries: new Map(Object.entries(autoFacts || {}))
  });
  const ocrSummary = normalizeOcrSummary({
    enabled: Boolean(ocrResult?.enabled),
    executed: Boolean(ocrResult?.executed),
    reason: ocrResult?.reason || null,
    suspicious_table_keys: suspiciousTableKeys,
    processed_tables: Array.isArray(ocrResult?.processed_tables) ? ocrResult.processed_tables : [],
    skipped_tables: Array.isArray(ocrResult?.skipped_tables) ? ocrResult.skipped_tables : [],
    matched_count: Number(ocrChannelFacts?.matchedCount || 0),
    mock_mode: Boolean(ocrResult?.mock_mode)
  });
  const previewBuild = buildPreviewFields({
    autoFacts,
    items: Array.isArray(items) ? items : [],
    rawChannelFacts,
    ocrChannelFacts
  });
  const validationIssues = await runArchivePreviewValidation({
    unitId: targetUnitId,
    year: Number(report.year),
    fields: previewBuild.fields
  });
  const mergedIssues = sanitizePreviewIssues([...previewBuild.issues, ...validationIssues]);
  const pendingLowCount = previewBuild.fields
    .filter((field) => LOW_CONFIDENCE_SET.has(field.confidence) && !field.confirmed)
    .length;
  const hasValidationError = validationIssues.some((issue) => issue.level === 'ERROR');
  const initialStatus = pendingLowCount === 0 && !hasValidationError
    ? PREVIEW_BATCH_STATUS.REVIEWED
    : PREVIEW_BATCH_STATUS.PENDING_REVIEW;

  const batchInsert = await client.query(
    `INSERT INTO archive_preview_batch
       (report_id, department_id, unit_id, year, report_type, file_name, raw_text, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      report.id,
      report.department_id,
      targetUnitId,
      report.year,
      report.report_type,
      report.file_name,
      rawText,
      initialStatus,
      userId
    ]
  );
  const batch = batchInsert.rows[0];

  for (const field of previewBuild.fields) {
    await client.query(
      `INSERT INTO archive_preview_field
         (batch_id, key, raw_value, normalized_value, confidence, match_source, raw_text_snippet, confirmed, corrected_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        batch.id,
        field.key,
        field.raw_value,
        field.normalized_value,
        field.confidence,
        field.match_source,
        field.raw_text_snippet,
        Boolean(field.confirmed),
        field.corrected_value
      ]
    );
  }

  for (const issue of mergedIssues) {
    await client.query(
      `INSERT INTO archive_preview_issue
         (batch_id, rule_id, level, message, evidence)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        batch.id,
        issue.rule_id,
        issue.level,
        issue.message,
        issue.evidence ? JSON.stringify(issue.evidence) : null
      ]
    );
  }

  // Persist OCR execution trace so the detail API can surface whether OCR ran and why.
  await client.query(
    `INSERT INTO archive_preview_issue
       (batch_id, rule_id, level, message, evidence)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      batch.id,
      OCR_TRACE_RULE_ID,
      'WARN',
      'OCR trace metadata',
      JSON.stringify(ocrSummary)
    ]
  );

  const confidenceCounts = previewBuild.fields.reduce((acc, field) => {
    acc[field.confidence] = (acc[field.confidence] || 0) + 1;
    return acc;
  }, {});

  return {
    batch,
    targetUnitId,
    fields: previewBuild.fields,
    issues: mergedIssues,
    confidenceCounts,
    reconciliationSummary: previewBuild.reconciliationSummary,
    ocrSummary
  };
};

const extractLineItemsFromTables = (tables) => {
  const items = [];

  tables.forEach((table) => {
    const columnKeys = VALUE_COLUMNS_BY_TABLE[table.table_key] || null;

    const rows = Array.isArray(table.rows) ? table.rows : [];
    rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length === 0) return;

      let idx = 0;
      const codes = [];

      while (idx < row.length && codes.length < 3) {
        const cell = row[idx] ? String(row[idx]).trim() : '';
        if (!cell) {
          idx += 1;
          continue;
        }
        if (/^\d+$/.test(cell)) {
          codes.push(cell);
          idx += 1;
          continue;
        }
        break;
      }

      if (codes.length === 0) return;

      const nameCell = row[idx] ? String(row[idx]).trim() : '';
      if (!nameCell || /^\d+$/.test(nameCell)) return;

      idx += 1;
      const valueCells = row.slice(idx);
      const values = valueCells.map((cell) => parseNumeric(cell));

      const valuesJson = {};
      values.forEach((val, valIndex) => {
        if (val === null) return;
        const key = columnKeys
          ? (columnKeys[valIndex] || `extra_${valIndex + 1}`)
          : `col_${valIndex + 1}`;
        valuesJson[key] = val;
      });

      if (Object.keys(valuesJson).length === 0) return;

      items.push({
        table_key: table.table_key,
        row_index: rowIndex,
        class_code: codes[0] || null,
        type_code: codes[1] || null,
        item_code: codes[2] || null,
        item_name: nameCell,
        values_json: valuesJson
      });
    });
  });

  return items;
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // USE ABSOLUTE PATH TO BE SAFE
    const uploadDir = path.join(process.cwd(), 'uploads/archives');
    console.log('Upload: resolving destination:', uploadDir);
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      console.log('Upload: directory ensuring success');
      cb(null, uploadDir);
    } catch (error) {
      console.error('Upload: directory creation failed:', error);
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    console.log('Upload: processing file:', file.originalname);
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      console.error('Upload: Invalid file type');
      return cb(new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only PDF files are allowed'
      }));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Upload Annual Report PDF
router.post('/upload', requireAuth, requireRole(['admin', 'maintainer']), upload.single('file'), async (req, res, next) => {
  console.log('Upload: Route handler reached');
  console.log('Upload: Request body:', req.body);
  console.log('Upload: Request file:', req.file);

  const client = await db.getClient();
  try {
    if (!req.file) {
      throw new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'PDF file is required'
      });
    }

    const { department_id, year } = req.body;
    const reportTypeRaw = req.body.report_type;
    const report_type = String(reportTypeRaw || '').toUpperCase();

    if (!department_id || !year || !report_type) {
      console.error('Upload: Missing fields:', { department_id, year, report_type });
      // Clean up uploaded file
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'department_id, year, and report_type are required'
      });
    }

    if (!['BUDGET', 'FINAL'].includes(report_type)) {
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_type must be BUDGET or FINAL'
      });
    }

    // Calculate file hash
    const fileBuffer = await fs.readFile(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    await client.query('BEGIN');

    // Fix filename encoding (often issues with multer handling non-ASCII on Windows)
    let originalName = req.file.originalname;
    try {
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      console.warn('Filename decoding failed, using original:', e);
    }

    // Insert report metadata
    const reportResult = await client.query(
      `INSERT INTO org_dept_annual_report 
       (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (department_id, year, report_type)
       DO UPDATE SET 
         file_name = EXCLUDED.file_name,
         file_path = EXCLUDED.file_path,
         file_hash = EXCLUDED.file_hash,
         file_size = EXCLUDED.file_size,
         uploaded_by = EXCLUDED.uploaded_by,
         updated_at = NOW()
       RETURNING *`,
      [
        department_id,
        parseInt(year),
        report_type,
        originalName,
        req.file.path,
        fileHash,
        req.file.size,
        req.user.id
      ]
    );

    const report = reportResult.rows[0];

    // Extract text from PDF
    let extractedText = '';
    try {
      const parser = new PDFParse({ data: fileBuffer });
      const pdfData = await parser.getText({
        cellSeparator: '\t',
        lineEnforce: true,
        pageJoiner: '\n-- page_number of total_number --\n'
      });
      extractedText = pdfData.text || '';
      await parser.destroy();
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      // Continue even if PDF parsing fails
    }

    if (!['BUDGET', 'FINAL'].includes(report_type)) {
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_type must be BUDGET or FINAL'
      });
    }

    let tables = [];
    let lineItems = [];
    if (extractedText) {
      const sections = extractSectionsFromText(extractedText);
      tables = extractTablesFromText(extractedText);
      lineItems = extractLineItemsFromTables(tables);

      const upsertTextContent = async (category, content) => {
        if (!content) return;
        const finalContent = category === 'RAW' ? content : sanitizeReusableText(content, category);
        if (!finalContent) return;
        await client.query(
          `INSERT INTO org_dept_text_content 
           (department_id, year, report_type, category, content_text, source_report_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (department_id, year, report_type, category)
           DO UPDATE SET 
             content_text = EXCLUDED.content_text,
             source_report_id = EXCLUDED.source_report_id,
             updated_at = NOW()`,
          [department_id, parseInt(year), report_type, category, finalContent, report.id, req.user.id]
        );
      };

      await upsertTextContent('RAW', extractedText);

      const categories = {
        FUNCTION: sections.FUNCTION,
        STRUCTURE: sections.STRUCTURE,
        TERMINOLOGY: sections.TERMINOLOGY,
        EXPLANATION: sections.EXPLANATION,
        OTHER: sections.OTHER
      };

      for (const [category, content] of Object.entries(categories)) {
        await upsertTextContent(category, content);
      }

      // Extract and save structured sub-sections for year-over-year reuse
      const explanationSubs = extractExplanationSubSections(sections.EXPLANATION);
      const otherSubs = extractOtherSubSections(sections.OTHER);
      for (const [subCategory, subContent] of Object.entries({ ...explanationSubs, ...otherSubs })) {
        await upsertTextContent(subCategory, subContent);
      }

      if (tables.length > 0) {
        await client.query('DELETE FROM org_dept_table_data WHERE report_id = $1', [report.id]);
      }

      for (const table of tables) {
        await client.query(
          `INSERT INTO org_dept_table_data
           (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (report_id, table_key)
           DO UPDATE SET
             table_title = EXCLUDED.table_title,
             page_numbers = EXCLUDED.page_numbers,
             row_count = EXCLUDED.row_count,
             col_count = EXCLUDED.col_count,
             data_json = EXCLUDED.data_json,
             updated_at = NOW()`,
          [
            report.id,
            department_id,
            parseInt(year),
            report_type,
            table.table_key,
            table.table_title,
            table.page_numbers,
            table.row_count,
            table.col_count,
            JSON.stringify(table.rows),
            req.user.id
          ]
        );
      }

      if (lineItems.length > 0) {
        await client.query('DELETE FROM org_dept_line_items WHERE report_id = $1', [report.id]);
      }

      for (const item of lineItems) {
        await client.query(
          `INSERT INTO org_dept_line_items
           (report_id, department_id, year, report_type, table_key, row_index, class_code, type_code, item_code, item_name, values_json, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (report_id, table_key, row_index)
           DO UPDATE SET
             class_code = EXCLUDED.class_code,
             type_code = EXCLUDED.type_code,
             item_code = EXCLUDED.item_code,
             item_name = EXCLUDED.item_name,
             values_json = EXCLUDED.values_json,
             updated_at = NOW()`,
          [
            report.id,
            department_id,
            parseInt(year),
            report_type,
            item.table_key,
            item.row_index,
            item.class_code,
            item.type_code,
            item.item_code,
            item.item_name,
            JSON.stringify(item.values_json),
            req.user.id
          ]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      report,
      extracted_text_length: extractedText.length,
      table_count: tables.length,
      line_item_count: lineItems.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload: Error processing request:', error);
    // Clean up file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    return next(error);
  } finally {
    client.release();
  }
});

// Get Archives for Department/Year
router.get('/departments/:deptId/years', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { deptId } = req.params;
    const yearsResult = await db.query(
      `SELECT DISTINCT year
       FROM org_dept_annual_report
       WHERE department_id = $1
       ORDER BY year DESC`,
      [deptId]
    );

    return res.json({
      years: yearsResult.rows.map((row) => Number(row.year)).filter((value) => Number.isInteger(value))
    });
  } catch (error) {
    return next(error);
  }
});

const deleteReportHandler = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { reportId } = req.params;

    // Check if report exists
    const reportCheck = await client.query(
      'SELECT id, department_id, year, file_name FROM org_dept_annual_report WHERE id = $1',
      [reportId]
    );

    if (reportCheck.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Report not found'
      });
    }

    const report = reportCheck.rows[0];

    await client.query('BEGIN');

    // 1. Delete associated text content
    await client.query('DELETE FROM org_dept_text_content WHERE source_report_id = $1', [reportId]);

    // 2. Delete associated table data
    await client.query('DELETE FROM org_dept_table_data WHERE report_id = $1', [reportId]);

    // 3. Delete associated line items
    await client.query('DELETE FROM org_dept_line_items WHERE report_id = $1', [reportId]);

    // 4. Delete associated preview batches (logic linked to report_id)
    await client.query('DELETE FROM archive_preview_batch WHERE report_id = $1', [reportId]);

    // 5. Delete the report itself
    await client.query('DELETE FROM org_dept_annual_report WHERE id = $1', [reportId]);

    await client.query('COMMIT');

    console.log(`[DELETE] Deleted report ${report.file_name} (${reportId})`);
    return res.json({ success: true, message: '文件已删除' });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
};

router.delete('/reports/:reportId', requireAuth, requireRole(['admin', 'maintainer']), deleteReportHandler);
router.delete('/report/:reportId', requireAuth, requireRole(['admin', 'maintainer']), deleteReportHandler);
router.delete('/preview/reports/:reportId', requireAuth, requireRole(['admin', 'maintainer']), deleteReportHandler);

router.delete('/departments/:deptId/years/:year', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { deptId, year } = req.params;
    const unitId = req.query.unit_id ? String(req.query.unit_id) : null;
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'year must be a valid integer'
      });
    }

    await client.query('BEGIN');

    const reportRows = await client.query(
      `SELECT id, file_path
       FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );
    const filePaths = reportRows.rows.map((row) => row.file_path).filter(Boolean);

    const textDeleteResult = await client.query(
      `DELETE FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    const tableDeleteResult = await client.query(
      `DELETE FROM org_dept_table_data
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    const lineDeleteResult = await client.query(
      `DELETE FROM org_dept_line_items
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    const reportDeleteResult = await client.query(
      `DELETE FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    let historyDeleteCount = 0;
    if (unitId) {
      const historyDeleteResult = await client.query(
        `DELETE FROM history_actuals
         WHERE unit_id = $1
           AND year = $2
           AND stage = 'FINAL'
           AND provenance_source = ANY($3)`,
        [unitId, parsedYear, ['archive_parse', 'archive_preview_commit']]
      );
      historyDeleteCount = historyDeleteResult.rowCount;
    }

    await client.query('COMMIT');

    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        console.warn('Delete year: failed to remove file:', filePath, unlinkError?.message || unlinkError);
      }
    }

    return res.json({
      success: true,
      department_id: deptId,
      year: parsedYear,
      deleted: {
        reports: reportDeleteResult.rowCount,
        text_content: textDeleteResult.rowCount,
        table_data: tableDeleteResult.rowCount,
        line_items: lineDeleteResult.rowCount,
        history_actuals_archive_parse: historyDeleteCount
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/departments/:deptId/years/:year', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { deptId, year } = req.params;
    const reportType = req.query.report_type ? String(req.query.report_type).toUpperCase() : null;
    const reportTypeFilter = reportType && ['BUDGET', 'FINAL'].includes(reportType) ? reportType : null;

    // Get reports
    const reportsResult = await db.query(
      `SELECT * FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2
       ORDER BY report_type`,
      [deptId, parseInt(year)]
    );

    // Get text content
    const textResult = await db.query(
      `SELECT * FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2
         AND ($3::text IS NULL OR report_type = $3)
       ORDER BY category`,
      [deptId, parseInt(year), reportTypeFilter]
    );

    const tableResult = await db.query(
      `SELECT *
       FROM org_dept_table_data
       WHERE department_id = $1 AND year = $2
         AND ($3::text IS NULL OR report_type = $3)
       ORDER BY table_key`,
      [deptId, parseInt(year), reportTypeFilter]
    );

    const lineItemResult = await db.query(
      `SELECT *
       FROM org_dept_line_items
       WHERE department_id = $1 AND year = $2
         AND ($3::text IS NULL OR report_type = $3)
       ORDER BY table_key, row_index`,
      [deptId, parseInt(year), reportTypeFilter]
    );

    return res.json({
      reports: reportsResult.rows,
      text_content: textResult.rows.map((row) => ({
        ...row,
        content_text: sanitizeArchiveTextByCategory(row.category, row.content_text)
      })),
      table_data: tableResult.rows,
      line_items: lineItemResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

// Save/Update Text Content
router.post('/text-content', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { department_id, year, category, content_text } = req.body;
    const report_type = String(req.body?.report_type || 'BUDGET').toUpperCase();
    const normalizedContent = sanitizeReusableText(content_text, category);

    if (!department_id || !year || !category || !normalizedContent) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'department_id, year, category, and content_text are required'
      });
    }

    if (!['BUDGET', 'FINAL'].includes(report_type)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_type must be BUDGET or FINAL'
      });
    }

    const result = await db.query(
      `INSERT INTO org_dept_text_content 
       (department_id, year, report_type, category, content_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (department_id, year, report_type, category)
       DO UPDATE SET 
         content_text = EXCLUDED.content_text,
         updated_at = NOW()
       RETURNING *`,
      [department_id, parseInt(year), report_type, category, normalizedContent, req.user.id]
    );

    return res.json({ text_content: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Get Text Content by Category (for reuse in Workbench)
router.get('/text-content/:deptId/:year/:category', requireAuth, async (req, res, next) => {
  try {
    const { deptId, year, category } = req.params;
    const report_type = String(req.query.report_type || 'BUDGET').toUpperCase();

    const result = await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2 AND report_type = $3 AND category = $4`,
      [deptId, parseInt(year), report_type, category]
    );

    if (result.rows.length === 0) {
      return res.json({ content_text: null });
    }

    return res.json({
      content_text: sanitizeArchiveTextByCategory(category, result.rows[0].content_text)
    });
  } catch (error) {
    return next(error);
  }
});

// --- Parsing & Extraction Endpoints ---

// Local Regex Parser
router.post('/parse-budget-table', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { report_id } = req.body;
    if (!report_id) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_id is required'
      });
    }

    // Prefer structured table extraction first.
    const tableResult = await db.query(
      `SELECT table_key, data_json
       FROM org_dept_table_data
       WHERE report_id = $1`,
      [report_id]
    );
    const autoFacts = extractHistoryFactsFromTableData(tableResult.rows || []);
    const structuredItems = buildLocalParsedItemsFromAutoFacts(autoFacts);
    if (structuredItems.length > 0) {
      return res.json({
        items: structuredItems,
        source: 'STRUCTURED_TABLE'
      });
    }

    // Fallback: parse RAW text with regex when no structured table data is available.
    const textResult = await db.query(
      `SELECT content_text FROM org_dept_text_content 
       WHERE source_report_id = $1 AND category = 'RAW'`,
      [report_id]
    );

    if (textResult.rows.length === 0) {
      return res.json({ items: [] });
    }

    const rawText = textResult.rows[0].content_text;
    const items = extractRawTextFallbackItems(rawText);

    if (items.length === 0) {
      return res.json({ items: [], warning: 'NO_MATCHES_FOUND' });
    }

    return res.json({
      items,
      source: 'RAW_TEXT_FALLBACK'
    });
  } catch (error) {
    return next(error);
  }
});

// AI Parser (Generic OpenAI-compatible)
router.post('/parse-budget-table-ai', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { report_id, model_config } = req.body;
    const { provider, apiKey, model, baseUrl } = model_config || {};

    if (!apiKey) {
      throw new AppError({ statusCode: 400, message: 'API Key is required' });
    }

    // 1. Get RAW text
    const textResult = await db.query(
      `SELECT content_text FROM org_dept_text_content 
       WHERE source_report_id = $1 AND category = 'RAW'`,
      [report_id]
    );

    if (textResult.rows.length === 0 || !textResult.rows[0].content_text.trim()) {
      return res.json({ items: [], error: 'NO_SOURCE_TEXT' });
    }

    const rawText = textResult.rows[0].content_text.substring(0, 15000); // Limit context to avoid hitting limits

    // 2. Construct AI Query
    const systemPrompt = `You are a financial data extraction assistant. Extract budget line items from the provided text.
Return ONLY a JSON array of objects with 'key' (item name) and 'value' (number). 
Ignore headers, footers, and page numbers.
Example: [{"key": "Total Income", "value": 10000.00}]`;

    const userPrompt = `Extract budget items from this text:\n\n${rawText}`;

    // 3. Call External API (OpenAI Compatible)
    // Default URL for generic OpenAI use, but allows override (e.g. for local models or specific providers)
    const apiUrl = baseUrl || 'https://api.openai.com/v1/chat/completions';

    // Normalize model name if needed (some providers map model names differently)
    const targetModel = model || 'gpt-3.5-turbo';

    console.log(`AI Parse: Calling ${apiUrl} with model ${targetModel}`);

    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" } // Try to enforce JSON
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API Error:', errText);
      throw new AppError({ statusCode: 502, message: `AI API Failed: ${aiResponse.statusText}` });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices[0].message.content;

    // Parse JSON from content
    let parsedItems = [];
    try {
      // Handle case where model wraps JSON in markdown blocks
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/) || [content];
      const jsonStr = jsonMatch.length > 1 ? jsonMatch[1] : jsonMatch[0];

      const result = JSON.parse(jsonStr);
      // Supports flexible return format (array or object wrapper)
      parsedItems = Array.isArray(result) ? result : (result.items || result.data || []);
    } catch (e) {
      console.error('AI JSON Parse Error:', e, content);
      throw new AppError({ statusCode: 500, message: 'Failed to parse AI response' });
    }

    return res.json({ items: parsedItems });

  } catch (error) {
    return next(error);
  }
});

// Create Preview Batch (parse + confidence + validation)
router.post('/preview', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { report_id, unit_id, items } = req.body || {};
    if (!report_id) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_id is required'
      });
    }

    const reportRes = await client.query(
      `SELECT *
       FROM org_dept_annual_report
       WHERE id = $1`,
      [report_id]
    );
    if (reportRes.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Report not found'
      });
    }
    const report = reportRes.rows[0];
    const targetUnitId = await resolveTargetUnitId({ client, report, inputUnitId: unit_id || null });
    await loadApprovedAliasMappings(client);

    await client.query('BEGIN');
    const created = await createPreviewBatch({
      client,
      report,
      targetUnitId,
      items,
      userId: req.user.id
    });
    await client.query('COMMIT');

    return res.status(201).json({
      batch_id: created.batch.id,
      report_id: report.id,
      unit_id: created.targetUnitId,
      status: created.batch.status,
      field_count: created.fields.length,
      issue_count: created.issues.length,
      confidence_counts: created.confidenceCounts,
      reconciliation_summary: created.reconciliationSummary,
      ocr_summary: created.ocrSummary
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/preview/bulk', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { report_ids, unit_id, items_by_report } = req.body || {};
    if (!Array.isArray(report_ids) || report_ids.length === 0) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_ids[] is required'
      });
    }

    const normalizedReportIds = Array.from(new Set(
      report_ids.map((item) => String(item || '').trim()).filter((item) => item)
    ));
    if (normalizedReportIds.length > 50) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_ids[] cannot exceed 50 in one request'
      });
    }

    const reportRes = await client.query(
      `SELECT *
       FROM org_dept_annual_report
       WHERE id = ANY($1::uuid[])`,
      [normalizedReportIds]
    );
    const reportMap = new Map(reportRes.rows.map((row) => [row.id, row]));
    const missingReportIds = normalizedReportIds.filter((id) => !reportMap.has(id));
    if (missingReportIds.length > 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Some reports were not found',
        details: { missing_report_ids: missingReportIds }
      });
    }

    await loadApprovedAliasMappings(client);
    await client.query('BEGIN');

    const batches = [];
    for (const reportId of normalizedReportIds) {
      const report = reportMap.get(reportId);
      const targetUnitId = await resolveTargetUnitId({ client, report, inputUnitId: unit_id || null });
      const reportItems = items_by_report && Array.isArray(items_by_report[reportId])
        ? items_by_report[reportId]
        : [];
      const created = await createPreviewBatch({
        client,
        report,
        targetUnitId,
        items: reportItems,
        userId: req.user.id
      });
      batches.push({
        batch_id: created.batch.id,
        report_id: report.id,
        unit_id: created.targetUnitId,
        status: created.batch.status,
        field_count: created.fields.length,
        issue_count: created.issues.length,
        confidence_counts: created.confidenceCounts,
        reconciliation_summary: created.reconciliationSummary,
        ocr_summary: created.ocrSummary
      });
    }

    await client.query('COMMIT');
    return res.status(201).json({
      batch_count: batches.length,
      batches
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/preview', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const statuses = String(req.query.status || '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item);
    const safeStatuses = statuses.filter((item) => Object.values(PREVIEW_BATCH_STATUS).includes(item));
    const unitId = req.query.unit_id ? String(req.query.unit_id) : null;
    const year = Number.isInteger(Number(req.query.year)) ? Number(req.query.year) : null;

    const batchResult = await db.query(
      `SELECT b.*
       FROM archive_preview_batch b
       WHERE ($1::uuid IS NULL OR b.unit_id = $1)
         AND ($2::int IS NULL OR b.year = $2)
         AND (COALESCE(array_length($3::text[], 1), 0) = 0 OR b.status = ANY($3))
       ORDER BY b.created_at DESC`,
      [unitId, year, safeStatuses]
    );

    const batches = batchResult.rows || [];
    if (batches.length === 0) {
      return res.json({ batches: [] });
    }

    const batchIds = batches.map((batch) => batch.id);
    const fieldCountResult = await db.query(
      `SELECT batch_id, COUNT(*)::int AS field_count
       FROM archive_preview_field
       WHERE batch_id = ANY($1::uuid[])
       GROUP BY batch_id`,
      [batchIds]
    );
    const issueResult = await db.query(
      `SELECT id, batch_id, rule_id, level, message, evidence
       FROM archive_preview_issue
       WHERE batch_id = ANY($1::uuid[])`,
      [batchIds]
    );

    const fieldCountMap = new Map(fieldCountResult.rows.map((row) => [row.batch_id, Number(row.field_count) || 0]));
    const issueRowsByBatch = new Map();
    for (const issue of issueResult.rows || []) {
      const key = issue.batch_id;
      const group = issueRowsByBatch.get(key) || [];
      group.push(issue);
      issueRowsByBatch.set(key, group);
    }

    const issueCountMap = new Map();
    for (const [batchId, issueRows] of issueRowsByBatch.entries()) {
      issueCountMap.set(batchId, sanitizePreviewIssues(issueRows).length);
    }

    const payload = batches.map((batch) => ({
      ...batch,
      field_count: fieldCountMap.get(batch.id) || 0,
      issue_count: issueCountMap.get(batch.id) || 0
    }));

    return res.json({ batches: payload });
  } catch (error) {
    return next(error);
  }
});

router.get('/preview/:batchId', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const batchResult = await db.query(
      `SELECT *
       FROM archive_preview_batch
       WHERE id = $1`,
      [req.params.batchId]
    );
    if (batchResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Preview batch not found'
      });
    }

    const batch = batchResult.rows[0];

    const fieldsResult = await db.query(
      `SELECT *
       FROM archive_preview_field
       WHERE batch_id = $1
       ORDER BY key`,
      [req.params.batchId]
    );
    const issuesResult = await db.query(
      `SELECT *
       FROM archive_preview_issue
       WHERE batch_id = $1
       ORDER BY level DESC, created_at ASC`,
      [req.params.batchId]
    );
    const issueRows = issuesResult.rows || [];
    const ocrSummary = extractOcrSummaryFromIssues(issueRows);
    const sanitizedIssues = sanitizePreviewIssues(issueRows);

    // Fetch original table data associated with this batch's report
    const tablesResult = await db.query(
      `SELECT id, table_key, table_title, page_numbers, row_count, col_count, data_json
       FROM org_dept_table_data
       WHERE report_id = $1
       ORDER BY 
         CASE table_key
           WHEN 'budget_summary' THEN 1
           WHEN 'income_summary' THEN 2
           WHEN 'expenditure_summary' THEN 3
           WHEN 'fiscal_grant_summary' THEN 4
           WHEN 'general_budget' THEN 5
           WHEN 'gov_fund_budget' THEN 6
           WHEN 'capital_budget' THEN 7
           WHEN 'basic_expenditure' THEN 8
           WHEN 'three_public' THEN 9
           WHEN 'fiscal_grant_expenditure' THEN 10
           WHEN 'gov_fund_expenditure' THEN 11
           WHEN 'fiscal_transfer_expenditure' THEN 12
           WHEN 'gov_purchase' THEN 13
           ELSE 99
         END`,
      [batch.report_id]
    );

    return res.json({
      batch,
      fields: fieldsResult.rows,
      issues: sanitizedIssues,
      tables: tablesResult.rows,
      ocr_summary: ocrSummary
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/preview/:batchId/fields/:fieldId', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { confirmed, corrected_value } = req.body || {};
    await client.query('BEGIN');

    const fieldResult = await client.query(
      `SELECT f.*, b.status, b.unit_id, b.year
       FROM archive_preview_field f
       JOIN archive_preview_batch b ON b.id = f.batch_id
       WHERE f.id = $1
         AND f.batch_id = $2
       FOR UPDATE`,
      [req.params.fieldId, req.params.batchId]
    );
    if (fieldResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Preview field not found'
      });
    }
    const field = fieldResult.rows[0];
    if ([PREVIEW_BATCH_STATUS.COMMITTED, PREVIEW_BATCH_STATUS.REJECTED].includes(field.status)) {
      throw new AppError({
        statusCode: 409,
        code: 'BATCH_READ_ONLY',
        message: 'Current batch is read-only'
      });
    }

    const nextCorrected = corrected_value === null || corrected_value === undefined || corrected_value === ''
      ? null
      : toFactNumber(corrected_value);
    const hasConfirmed = typeof confirmed === 'boolean';
    const nextConfirmed = hasConfirmed ? confirmed : field.confirmed;

    const updated = await client.query(
      `UPDATE archive_preview_field
       SET corrected_value = $1,
           confirmed = $2,
           confirmed_by = CASE WHEN $3 THEN $4 ELSE confirmed_by END,
           confirmed_at = CASE WHEN $3 THEN NOW() ELSE confirmed_at END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [nextCorrected, nextConfirmed, hasConfirmed, req.user.id, field.id]
    );

    const predicted = toFactNumber(field.normalized_value);
    if (nextCorrected !== null && (predicted === null || !valuesNearlyEqual(nextCorrected, predicted))) {
      const aliasRawLabel = field.raw_text_snippet || field.raw_value || field.key;
      const normalizedAliasLabel = normalizeText(aliasRawLabel);
      await client.query(
        `INSERT INTO archive_correction_feedback
           (batch_id, field_key, raw_text, predicted_value, corrected_value, operator_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.params.batchId,
          field.key,
          aliasRawLabel,
          predicted,
          nextCorrected,
          req.user.id
        ]
      );

      if (normalizedAliasLabel) {
        await client.query(
          `INSERT INTO custom_alias_mapping
             (raw_label, normalized_label, resolved_key, status, source_batch_id)
           VALUES ($1, $2, $3, 'CANDIDATE', $4)
           ON CONFLICT (normalized_label, resolved_key)
           DO UPDATE SET
             raw_label = EXCLUDED.raw_label,
             source_batch_id = EXCLUDED.source_batch_id,
             status = CASE
               WHEN custom_alias_mapping.status = 'APPROVED' THEN custom_alias_mapping.status
               ELSE 'CANDIDATE'
             END,
             updated_at = NOW()`,
          [
            aliasRawLabel,
            normalizedAliasLabel,
            field.key,
            req.params.batchId
          ]
        );
      }
    }

    const allFieldsResult = await client.query(
      `SELECT *
       FROM archive_preview_field
       WHERE batch_id = $1`,
      [req.params.batchId]
    );
    const validationIssues = await refreshArchiveValidationIssues({
      client,
      batchId: req.params.batchId,
      unitId: field.unit_id || null,
      year: Number(field.year || 0),
      fields: allFieldsResult.rows
    });

    const pendingLowCount = allFieldsResult.rows
      .filter((item) => LOW_CONFIDENCE_SET.has(item.confidence) && !item.confirmed)
      .length;
    const hasValidationError = validationIssues.some((item) => item.level === 'ERROR');
    const nextBatchStatus = pendingLowCount === 0 && !hasValidationError
      ? PREVIEW_BATCH_STATUS.REVIEWED
      : PREVIEW_BATCH_STATUS.PENDING_REVIEW;

    await client.query(
      `UPDATE archive_preview_batch
       SET status = $1,
           reviewed_at = CASE WHEN $1 = 'REVIEWED' THEN NOW() ELSE reviewed_at END,
           updated_at = NOW()
       WHERE id = $2`,
      [nextBatchStatus, req.params.batchId]
    );

    await client.query('COMMIT');
    return res.json({ field: updated.rows[0], batch_status: nextBatchStatus });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/preview/:batchId/commit', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const batchResult = await client.query(
      `SELECT *
       FROM archive_preview_batch
       WHERE id = $1
       FOR UPDATE`,
      [req.params.batchId]
    );
    if (batchResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Preview batch not found'
      });
    }
    const batch = batchResult.rows[0];
    if (batch.status === PREVIEW_BATCH_STATUS.COMMITTED) {
      throw new AppError({
        statusCode: 409,
        code: 'ALREADY_COMMITTED',
        message: 'Batch already committed'
      });
    }
    if (batch.status === PREVIEW_BATCH_STATUS.REJECTED) {
      throw new AppError({
        statusCode: 409,
        code: 'BATCH_REJECTED',
        message: 'Rejected batch cannot be committed'
      });
    }

    const fieldsResult = await client.query(
      `SELECT *
       FROM archive_preview_field
       WHERE batch_id = $1
       ORDER BY key`,
      [batch.id]
    );
    const fields = fieldsResult.rows;
    const validationIssues = await refreshArchiveValidationIssues({
      client,
      batchId: batch.id,
      unitId: batch.unit_id,
      year: Number(batch.year),
      fields
    });
    const errorIssues = validationIssues.filter((issue) => issue.level === 'ERROR');
    if (errorIssues.length > 0) {
      throw new AppError({
        statusCode: 409,
        code: 'VALIDATION_BLOCKED',
        message: 'Preview validation failed with blocking issues',
        details: {
          issue_count: errorIssues.length,
          issues: errorIssues.slice(0, 20)
        }
      });
    }

    const pendingLowConfidence = fields.filter((field) => LOW_CONFIDENCE_SET.has(field.confidence) && !field.confirmed);
    if (pendingLowConfidence.length > 0) {
      throw new AppError({
        statusCode: 409,
        code: 'CONFIRMATION_REQUIRED',
        message: '提交前请先确认所有低置信字段（可勾选确认或点击“一键确认低置信”）',
        details: {
          pending_keys: pendingLowConfidence.map((item) => item.key)
        }
      });
    }

    const writableFields = fields
      .map((field) => ({
        key: field.key,
        value: getEffectiveFieldValue(field)
      }))
      .filter((field) => field.value !== null);

    let lockedKeys = new Set();
    if (writableFields.length > 0) {
      const lockedResult = await client.query(
        `SELECT key
         FROM history_actuals
         WHERE unit_id = $1
           AND year = $2
           AND stage = 'FINAL'
           AND is_locked = true
           AND key = ANY($3)`,
        [batch.unit_id, batch.year, writableFields.map((item) => item.key)]
      );
      lockedKeys = new Set(lockedResult.rows.map((row) => row.key));
    }

    let upsertedCount = 0;
    for (const field of writableFields) {
      if (lockedKeys.has(field.key)) continue;
      const upsertResult = await client.query(
        `INSERT INTO history_actuals
           (unit_id, year, stage, key, value_numeric, source_batch_id, source_preview_batch_id, is_locked, provenance_source)
         VALUES ($1, $2, 'FINAL', $3, $4, NULL, $5, false, 'archive_preview_commit')
         ON CONFLICT (unit_id, year, stage, key)
         DO UPDATE SET
           value_numeric = EXCLUDED.value_numeric,
           provenance_source = EXCLUDED.provenance_source,
           source_preview_batch_id = EXCLUDED.source_preview_batch_id,
           updated_at = NOW()
         WHERE history_actuals.is_locked = false
         RETURNING key`,
        [batch.unit_id, batch.year, field.key, field.value, batch.id]
      );
      upsertedCount += upsertResult.rowCount;
    }

    await client.query(
      `UPDATE archive_preview_batch
       SET status = $1,
           committed_at = NOW(),
           committed_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [PREVIEW_BATCH_STATUS.COMMITTED, req.user.id, batch.id]
    );

    await client.query('COMMIT');
    return res.json({
      success: true,
      batch_id: batch.id,
      status: PREVIEW_BATCH_STATUS.COMMITTED,
      upserted_count: upsertedCount,
      locked_skipped: Array.from(lockedKeys)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.delete('/preview/:batchId', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const existing = await db.query(
      `SELECT id, status
       FROM archive_preview_batch
       WHERE id = $1`,
      [req.params.batchId]
    );
    if (existing.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Preview batch not found'
      });
    }
    if (existing.rows[0].status === PREVIEW_BATCH_STATUS.COMMITTED) {
      throw new AppError({
        statusCode: 409,
        code: 'BATCH_READ_ONLY',
        message: 'Committed batch cannot be rejected'
      });
    }

    const result = await db.query(
      `UPDATE archive_preview_batch
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [PREVIEW_BATCH_STATUS.REJECTED, req.params.batchId]
    );
    return res.json({ success: true, batch: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Permanently delete a preview batch (physical delete)
router.delete('/preview/:batchId/permanent', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, status, unit_id, year
       FROM archive_preview_batch
       WHERE id = $1
       FOR UPDATE`,
      [req.params.batchId]
    );
    if (existing.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Preview batch not found'
      });
    }

    const batch = existing.rows[0];
    let deletedHistoryActuals = 0;
    if (batch.status === PREVIEW_BATCH_STATUS.COMMITTED) {
      // Preferred path for new data: delete rows explicitly attributed to this preview batch.
      const attributedDelete = await client.query(
        `DELETE FROM history_actuals
         WHERE source_preview_batch_id = $1
           AND stage = 'FINAL'
           AND provenance_source = 'archive_preview_commit'`,
        [batch.id]
      );
      deletedHistoryActuals += attributedDelete.rowCount;

      // Backward compatibility for previously committed batches before attribution column existed.
      const fieldsResult = await client.query(
        `SELECT key, normalized_value, corrected_value
         FROM archive_preview_field
         WHERE batch_id = $1`,
        [batch.id]
      );

      for (const field of fieldsResult.rows) {
        const value = getEffectiveFieldValue(field);
        if (value === null) continue;
        // Only delete legacy rows without explicit batch attribution to avoid touching newer commits.
        // eslint-disable-next-line no-await-in-loop
        const legacyDelete = await client.query(
          `DELETE FROM history_actuals
           WHERE unit_id = $1
             AND year = $2
             AND stage = 'FINAL'
             AND key = $3
             AND provenance_source = 'archive_preview_commit'
             AND source_preview_batch_id IS NULL
             AND value_numeric = $4`,
          [batch.unit_id, batch.year, field.key, value]
        );
        deletedHistoryActuals += legacyDelete.rowCount;
      }
    }

    // Physical delete - CASCADE will automatically delete related fields and issues
    await client.query(
      `DELETE FROM archive_preview_batch
       WHERE id = $1`,
      [req.params.batchId]
    );

    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Batch permanently deleted',
      deleted_history_actuals: deletedHistoryActuals
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});


router.get('/alias-mappings', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const statuses = String(req.query.status || '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item);
    const safeStatuses = statuses.filter((item) => ['CANDIDATE', 'APPROVED', 'REJECTED'].includes(item));
    const resolvedKey = req.query.resolved_key ? String(req.query.resolved_key).trim() : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const result = await db.query(
      `SELECT *
       FROM custom_alias_mapping
       WHERE (COALESCE(array_length($1::text[], 1), 0) = 0 OR status = ANY($1))
         AND ($2::text IS NULL OR resolved_key = $2)
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $3`,
      [safeStatuses, resolvedKey, limit]
    );
    return res.json({ aliases: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/alias-mappings/:aliasId', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const nextStatus = String(req.body?.status || '').toUpperCase();
    if (!['CANDIDATE', 'APPROVED', 'REJECTED'].includes(nextStatus)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'status must be CANDIDATE, APPROVED, or REJECTED'
      });
    }

    const updateResult = await client.query(
      `UPDATE custom_alias_mapping
       SET status = $1,
           approved_by = CASE WHEN $1 = 'APPROVED' THEN $2::uuid ELSE NULL END,
           approved_at = CASE WHEN $1 = 'APPROVED' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [nextStatus, req.user.id, req.params.aliasId]
    );
    if (updateResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Alias mapping not found'
      });
    }

    await loadApprovedAliasMappings(client);
    return res.json({ alias: updateResult.rows[0] });
  } catch (error) {
    return next(error);
  } finally {
    client.release();
  }
});

// Save Extracted Facts
router.post('/save-budget-facts', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { report_id, unit_id, items } = req.body;

    if (!report_id || !Array.isArray(items)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_id and items[] are required'
      });
    }

    const reportRes = await client.query('SELECT * FROM org_dept_annual_report WHERE id = $1', [report_id]);
    if (reportRes.rows.length === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Report not found'
      });
    }
    const report = reportRes.rows[0];

    let targetUnitId = unit_id || null;
    if (targetUnitId) {
      const unitCheck = await client.query(
        `SELECT id
         FROM org_unit
         WHERE id = $1
           AND department_id = $2`,
        [targetUnitId, report.department_id]
      );
      if (unitCheck.rowCount === 0) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'unit_id does not belong to report department'
        });
      }
    } else {
      const fallbackUnit = await client.query(
        `SELECT id
         FROM org_unit
         WHERE department_id = $1
         ORDER BY sort_order ASC, created_at ASC
         LIMIT 1`,
        [report.department_id]
      );
      if (fallbackUnit.rowCount === 0) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'No unit found for report department'
        });
      }
      targetUnitId = fallbackUnit.rows[0].id;
    }

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO org_dept_text_content 
         (department_id, year, report_type, category, content_text, source_report_id, created_by)
         VALUES ($1, $2, $3, 'DATA_JSON', $4, $5, $6)
         ON CONFLICT (department_id, year, report_type, category)
         DO UPDATE SET 
           content_text = EXCLUDED.content_text,
           source_report_id = EXCLUDED.source_report_id,
           updated_at = NOW()`,
      [report.department_id, report.year, report.report_type, JSON.stringify(items), report_id, req.user.id]
    );

    const tableDataRes = await client.query(
      `SELECT table_key, data_json
       FROM org_dept_table_data
       WHERE report_id = $1`,
      [report_id]
    );
    await loadApprovedAliasMappings(client);
    const autoFacts = extractHistoryFactsFromTableData(tableDataRes.rows || []);

    const mappedEntries = new Map(Object.entries(autoFacts));
    const autoFactKeys = new Set(Object.keys(autoFacts));
    const manualConflicts = [];
    const manualScaled = [];
    const unmatched = [];

    for (const item of items) {
      const rawLabel = String(item?.key || '').trim();
      const numeric = Number(item?.value);
      if (!rawLabel || !Number.isFinite(numeric)) {
        continue;
      }

      const matchedKey = resolveHistoryActualKey(rawLabel);
      if (!matchedKey) {
        unmatched.push(rawLabel);
        continue;
      }

      // Structured table extraction is the most reliable source.
      // Manual parse values are only used to fill missing keys, not override auto facts.
      if (autoFactKeys.has(matchedKey)) {
        const autoValue = Number(mappedEntries.get(matchedKey));
        if (!valuesNearlyEqual(autoValue, numeric)) {
          manualConflicts.push({
            key: matchedKey,
            auto_value: autoValue,
            manual_value: numeric,
            reason: isLikelyUnitScaleMismatch(autoValue, numeric)
              ? 'UNIT_SCALE_MISMATCH'
              : 'AUTO_FACT_PROTECTED'
          });
        }
        continue;
      }

      const normalizedManual = normalizeManualFactValue({
        rawLabel,
        matchedKey,
        numeric,
        mappedEntries
      });

      mappedEntries.set(matchedKey, normalizedManual.value);

      if (normalizedManual.normalized && !valuesNearlyEqual(normalizedManual.value, numeric)) {
        manualScaled.push({
          key: matchedKey,
          original_manual_value: numeric,
          normalized_value: normalizedManual.value,
          reason: normalizedManual.reason
        });
      }
    }

    let upsertedCount = 0;
    const mappedKeys = Array.from(mappedEntries.keys());
    let lockedKeys = new Set();

    if (mappedKeys.length > 0) {
      const lockedResult = await client.query(
        `SELECT key
         FROM history_actuals
         WHERE unit_id = $1
           AND year = $2
           AND stage = 'FINAL'
           AND is_locked = true
           AND key = ANY($3)`,
        [targetUnitId, report.year, mappedKeys]
      );
      lockedKeys = new Set(lockedResult.rows.map((row) => row.key));
    }

    for (const [factKey, factValue] of mappedEntries.entries()) {
      if (lockedKeys.has(factKey)) continue;

      const upsertResult = await client.query(
        `INSERT INTO history_actuals
           (unit_id, year, stage, key, value_numeric, source_batch_id, is_locked, provenance_source)
         VALUES ($1, $2, 'FINAL', $3, $4, NULL, false, 'archive_parse')
         ON CONFLICT (unit_id, year, stage, key)
         DO UPDATE SET
           value_numeric = EXCLUDED.value_numeric,
           provenance_source = EXCLUDED.provenance_source,
           updated_at = NOW()
         WHERE history_actuals.is_locked = false
         RETURNING key`,
        [targetUnitId, report.year, factKey, factValue]
      );
      upsertedCount += upsertResult.rowCount;
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      unit_id: targetUnitId,
      year: Number(report.year),
      auto_mapped_count: Object.keys(autoFacts).length,
      mapped_count: mappedEntries.size,
      upserted_count: upsertedCount,
      locked_skipped: Array.from(lockedKeys),
      manual_conflict_skipped_count: manualConflicts.length,
      manual_conflicts: manualConflicts.slice(0, 20),
      manual_scaled_count: manualScaled.length,
      manual_scaled: manualScaled.slice(0, 20),
      unmatched_count: unmatched.length,
      unmatched_labels: unmatched.slice(0, 20)
    });

  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
