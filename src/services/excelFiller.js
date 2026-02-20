const path = require('node:path');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');


const normalizeUnitName = (raw) => {
  if (!raw) return '';
  let text = String(raw).trim();
  text = text.replace(/预算单位[:：]?/, '').trim();
  text = text.replace(/（?部门）?主要职能.*$/, '').trim();
  text = text.replace(/（?单位）?主要职能.*$/, '').trim();
  text = text.replace(/主要职能.*$/, '').trim();
  text = text.replace(/[（(](部门|单位)[）)]$/g, '').trim();
  if (/^\d+$/.test(text)) return '';
  return text;
};

const resolveManualText = (values, key) => {
  const input = values?.manual_inputs?.[key];
  if (!input) return '';
  if (input.value_text) return String(input.value_text).trim();
  if (input.value_json !== null && input.value_json !== undefined) {
    return typeof input.value_json === 'string' ? input.value_json : JSON.stringify(input.value_json);
  }
  return '';
};

const ensureSentence = (text) => {
  const trimmed = String(text || '').trim().replace(/[。；;,.]+$/g, '');
  return trimmed ? `${trimmed}。` : '';
};

const normalizeReason = (text) => String(text || '')
  .trim()
  .replace(/^主要用于[:：]?\s*/g, '')
  .replace(/^主要原因是[:：]?\s*/g, '')
  .replace(/\d{4}年(?:当年)?预算执行数[^。；;\n]*[。；;]?/g, '')
  .replace(/上年(?:预算)?执行数[^。；;\n]*[。；;]?/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const compactReason = (text) => {
  const normalized = normalizeReason(text);
  if (!normalized) return '';
  const firstSentence = normalized.split(/[。；;]/).map((part) => part.trim()).find(Boolean) || normalized;
  return firstSentence.length > 48 ? `${firstSentence.slice(0, 48)}...` : firstSentence;
};

const buildLineItemLines = (values) => {
  const items = Array.isArray(values?.line_items_reason) ? values.line_items_reason : [];
  return items
    .map((item, index) => {
      const amountValue = Number(item.amount_current_wanyuan);
      if (!Number.isFinite(amountValue) || amountValue <= 0) return null;
      const amountText = amountValue.toFixed(2);
      const rawReason = item.reason_text && String(item.reason_text).trim()
        ? String(item.reason_text).trim()
        : '';

      if (rawReason && /万元/.test(rawReason)) {
        return `${index + 1}. ${ensureSentence(rawReason)}`;
      }

      const reason = compactReason(rawReason) || '待填写';
      return `${index + 1}. “${item.item_label}”科目${amountText}万元，主要用于${ensureSentence(reason)}`;
    })
    .filter(Boolean);
};

const normalizeBudgetChangeReason = (text) => {
  const reason = String(text || '')
    .trim()
    .replace(/^财政拨款收入支出(?:增加（减少）|增加|减少|持平)的主要原因是[:：]?\s*/g, '')
    .replace(/^主要原因是[:：]?\s*/g, '')
    .trim();
  return reason || '';
};

const BUDGET_CHANGE_REASON_LINE_REGEX = /财政拨款收入支出(?:增加（减少）|增加|减少|持平)的主要原因是[:：]?\s*[^。；;\n]*(?:[。；;]|$)/g;
const BUDGET_CHANGE_REASON_LINE_SINGLE_REGEX = /财政拨款收入支出(增加（减少）|增加|减少|持平)的主要原因是[:：]?\s*([^。；;\n]*)(?:[。；;]|$)/;

const stripBudgetChangeReasonLine = (text) => String(text || '')
  .replace(BUDGET_CHANGE_REASON_LINE_REGEX, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const extractBudgetChangeReasonFromOverview = (text) => {
  const matched = String(text || '').match(BUDGET_CHANGE_REASON_LINE_SINGLE_REGEX);
  if (!matched) return '';
  return normalizeBudgetChangeReason(matched[0]);
};

const inferFiscalTrend = (text) => {
  const source = String(text || '');
  const expenditureTrend = source.match(/财政拨款支出预算[^。；;\n]*比\d{4}年预算(增加|减少|持平)/);
  if (expenditureTrend?.[1]) return expenditureTrend[1];

  const revenueTrend = source.match(/财政拨款收入[^。；;\n]*比\d{4}年预算(增加|减少|持平)/);
  if (revenueTrend?.[1]) return revenueTrend[1];

  const reasonLine = source.match(BUDGET_CHANGE_REASON_LINE_SINGLE_REGEX);
  if (reasonLine?.[1]) return reasonLine[1];

  return '增加（减少）';
};

const buildProjectExpenseBlock = (values) => {
  const read = (key) => resolveManualText(values, key);
  const sections = [
    { title: '一、项目概述', text: read('project_overview') },
    { title: '二、立项依据', text: read('project_basis') },
    { title: '三、实施主体', text: read('project_subject') },
    { title: '四、实施方案', text: read('project_plan') },
    { title: '五、实施周期', text: read('project_cycle') },
    { title: '六、年度预算安排', text: read('project_budget_arrangement') },
    {
      title: '七、绩效目标',
      text: read('project_performance_goal') || read('performance_target') || read('performance_result')
    }
  ];

  const lines = ['七、项目经费情况说明'];
  for (const section of sections) {
    lines.push(section.title);
    lines.push(section.text && section.text.trim() ? section.text.trim() : '无');
  }
  return lines.join('\n');
};

const buildPayload = ({ values, year, caliber = 'unit' }) => {
  const resolvedYear = Number.isFinite(Number(year)) ? Number(year) : new Date().getFullYear();
  const normalizedCaliber = caliber === 'department' ? 'department' : 'unit';
  const isDepartment = normalizedCaliber === 'department';
  const subjectLabel = isDepartment ? '部门' : '单位';

  const unitName = normalizeUnitName(resolveManualText(values, 'unit_full_name'))
    || normalizeUnitName(resolveManualText(values, 'main_functions'));
  const budgetExplanationRaw = resolveManualText(values, 'budget_explanation');
  const budgetExplanation = stripBudgetChangeReasonLine(budgetExplanationRaw);
  const budgetChangeReason = normalizeBudgetChangeReason(resolveManualText(values, 'budget_change_reason'))
    || extractBudgetChangeReasonFromOverview(budgetExplanationRaw);
  const fiscalTrend = inferFiscalTrend(budgetExplanationRaw);
  const otherNotes = resolveManualText(values, 'other_notes');
  const projectExpenseBlock = buildProjectExpenseBlock(values);
  const mergedOtherNotes = isDepartment
    ? otherNotes
    : (/项目经费情况说明/.test(otherNotes) ? otherNotes : [otherNotes, projectExpenseBlock].filter(Boolean).join('\n\n'));

  const targetSheetNames = {
    functions: isDepartment ? '部门主要职能' : '单位职能',
    org: isDepartment ? '部门机构设置' : '单位机构设置',
    explanation: isDepartment ? '部门编制说明' : '单位编制说明',
    incomeExpense: isDepartment ? '部门收支总表' : '单位收支总表',
    income: isDepartment ? '部门收入总表' : '单位收入总表',
    expenditure: isDepartment ? '部门支出总表' : '单位支出总表',
    fiscalGrant: isDepartment ? '部门财政拨款收支总表' : '单位财政拨款收支总表',
    generalPublic: isDepartment ? '部门一般公共预算拨款表' : '单位一般公共预算拨款表',
    govFund: isDepartment ? '部门政府性基金拨款表' : '单位政府性基金拨款表',
    capital: isDepartment ? '部门国有资本经营预算拨款表 ' : '单位国有资本经营预算拨款表 ',
    basicDetail: isDepartment ? '部门一般公共预算拨款基本支出明细表' : '单位一般公共预算拨款基本支出明细表',
    threePublic: isDepartment ? '部门“三公”经费和机关运行费预算表' : '单位“三公”经费和机关运行费预算表',
    project: '项目经费情况说明'
  };

  const explanationLines = [];
  if (budgetExplanation) explanationLines.push(budgetExplanation);
  explanationLines.push(`财政拨款收入支出${fiscalTrend}的主要原因是${ensureSentence(budgetChangeReason || '待填写')}`);
  explanationLines.push('财政拨款支出主要内容如下：');

  return {
    caliber: normalizedCaliber,
    subjectLabel,
    year: resolvedYear,
    prevYear: resolvedYear - 1,
    unitName,
    coverUnitText: unitName
      ? `${isDepartment ? '预算主管部门' : '预算单位'}：${unitName}`
      : '',
    sheetMap: [
      { sourceCandidates: ['2.11单位职能（单位）', '3.11部门主要职能（部门）'], target: targetSheetNames.functions },
      { sourceCandidates: ['2.12单位机构设置（单位）', '3.12部门机构设置（部门）'], target: targetSheetNames.org },
      { sourceCandidates: ['2.13名词解释（单位）', '3.13名词解释（部门）'], target: '名词解释' },
      { sourceCandidates: ['2.15单位收支总表', '3.15部门收支总表'], target: targetSheetNames.incomeExpense },
      { sourceCandidates: ['2.16单位收入总表', '3.16部门收入总表'], target: targetSheetNames.income },
      { sourceCandidates: ['2.17单位支出总表', '3.17部门支出总表'], target: targetSheetNames.expenditure },
      { sourceCandidates: ['2.18单位财政拨款收支总表', '3.19部门财政拨款收支总表'], target: targetSheetNames.fiscalGrant },
      { sourceCandidates: ['2.20单位一般公共预算拨款表', '3.21部门一般公共预算支出功能分类预算表'], target: targetSheetNames.generalPublic },
      { sourceCandidates: ['2.21单位政府性基金拨款表', '3.22部门政府性基金预算支出功能分类预算表'], target: targetSheetNames.govFund },
      { sourceCandidates: ['2.22单位国有资本经营预算拨款表 ', '3.23部门国有资本经营预算支出功能分类预算表'], target: targetSheetNames.capital },
      { sourceCandidates: ['2.23单位一般公共预算拨款基本支出明细表', '3.24部门一般公共预算基本支出部门预算经济分类预算表'], target: targetSheetNames.basicDetail },
      { sourceCandidates: ['2.25单位“三公”经费和机关运行费预算表', '3.25部门“三公”经费和机关运行经费预算表'], target: targetSheetNames.threePublic },
      { sourceCandidates: ['2.26其他相关情况说明（单位）', '3.26其他相关情况说明（部门）'], target: '其他相关情况说明' }
    ],
    sheetNames: {
      cover: '封面',
      directory: '目录',
      explanation: targetSheetNames.explanation,
      functions: targetSheetNames.functions,
      org: targetSheetNames.org,
      glossary: '名词解释',
      other: '其他相关情况说明',
      project: targetSheetNames.project,
      tableGovFund: targetSheetNames.govFund,
      tableCapital: targetSheetNames.capital,
      tableThreePublic: targetSheetNames.threePublic
    },
    tableSheets: [
      targetSheetNames.incomeExpense,
      targetSheetNames.income,
      targetSheetNames.expenditure,
      targetSheetNames.fiscalGrant,
      targetSheetNames.generalPublic,
      targetSheetNames.govFund,
      targetSheetNames.capital,
      targetSheetNames.basicDetail,
      targetSheetNames.threePublic
    ],
    yearUpdateSheets: ['封面', '目录', targetSheetNames.explanation, '其他相关情况说明', targetSheetNames.project],
    manualTexts: {
      main_functions: resolveManualText(values, 'main_functions'),
      organizational_structure: resolveManualText(values, 'organizational_structure'),
      glossary: resolveManualText(values, 'glossary'),
      other_notes: mergedOtherNotes,
      explanation_block: explanationLines.filter(Boolean).join('\n'),
      project_expense: projectExpenseBlock
    },
    lineItemLines: buildLineItemLines(values)
  };
};

const parseCellText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map((part) => String(part?.text || '')).join('');
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result')) {
    return parseCellText(value.result);
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'text')) {
    return String(value.text || '');
  }
  return String(value);
};

const getColumnSpanWidth = (sheet, colStart, span = 1) => {
  let total = 0;
  const safeSpan = Math.max(1, span);
  for (let idx = 0; idx < safeSpan; idx += 1) {
    const col = sheet.getColumn(colStart + idx);
    total += Number.isFinite(col.width) ? col.width : 8.43;
  }
  return total;
};

/**
 * Helper to adjust row height based on text content (autofit approximation)
 */
const adjustRowHeight = (row, text, options = {}) => {
  if (!text) return;
  const {
    charsPerLine = 40,
    minHeight = 20,
    maxHeight = 42,
    respectExistingHeight = true
  } = options;
  const lines = String(text).split(/\r?\n/);
  const safeCharsPerLine = Math.max(12, charsPerLine);
  const estimateUnits = (line) => Array.from(line || '').reduce((total, ch) => {
    if (/\s/.test(ch)) return total + 0.5;
    const code = ch.codePointAt(0) || 0;
    return total + (code > 0x7f ? 1.6 : 1);
  }, 0);
  let visualLines = 0;
  for (const line of lines) {
    const units = estimateUnits(line);
    visualLines += Math.max(1, Math.ceil(units / safeCharsPerLine));
  }
  const baseHeight = 15.6;
  const currentHeight = Number(row.height);
  const lowerBound = respectExistingHeight && Number.isFinite(currentHeight) && currentHeight > 0
    ? Math.max(minHeight, currentHeight)
    : minHeight;
  const targetHeight = Math.min(maxHeight, Math.max(lowerBound, visualLines * baseHeight * 1.18));
  row.height = targetHeight;
};

const estimateCharUnits = (ch) => {
  if (!ch) return 0;
  if (/[ \t]/.test(ch)) return 0.5;
  const code = ch.codePointAt(0) || 0;
  return code > 0x7f ? 1.6 : 1;
};

const estimateTextUnits = (text) => Array.from(String(text || ''))
  .reduce((total, ch) => total + estimateCharUnits(ch), 0);

const NUMERIC_TOKEN_REGEX = /^\d[\d,]*(?:\.\d+)?/;
const LATIN_TOKEN_REGEX = /^[A-Za-z][A-Za-z0-9_./-]*/;
const WHITESPACE_TOKEN_REGEX = /^[ \t]+/;
const PUNCTUATION_TOKEN_REGEX = /^[,，。；;：:、）》）】\]」』”’!?！？]/;

const tokenizeLineForWrap = (line) => {
  const source = String(line || '');
  const tokens = [];
  let cursor = 0;

  while (cursor < source.length) {
    const slice = source.slice(cursor);

    const ws = slice.match(WHITESPACE_TOKEN_REGEX);
    if (ws) {
      tokens.push(ws[0]);
      cursor += ws[0].length;
      continue;
    }

    const numeric = slice.match(NUMERIC_TOKEN_REGEX);
    if (numeric) {
      tokens.push(numeric[0]);
      cursor += numeric[0].length;
      continue;
    }

    const latin = slice.match(LATIN_TOKEN_REGEX);
    if (latin) {
      tokens.push(latin[0]);
      cursor += latin[0].length;
      continue;
    }

    const [ch] = Array.from(slice);
    tokens.push(ch);
    cursor += ch.length;
  }

  return tokens;
};

const wrapLineByVisualWidth = (line, charsPerLine) => {
  const safeWidth = Math.max(10, Number(charsPerLine) || 10);
  const text = String(line || '');
  if (!text) return [''];

  const pushChunk = (chunks, chunk) => {
    const trimmed = String(chunk || '').replace(/\s+$/g, '');
    if (trimmed) {
      chunks.push(trimmed);
    }
  };

  const breakOverlongToken = (token, width) => {
    const parts = [];
    let current = '';
    let units = 0;
    for (const ch of Array.from(String(token || ''))) {
      const charUnits = estimateCharUnits(ch);
      if (current && units + charUnits > width) {
        parts.push(current);
        current = ch;
        units = charUnits;
        continue;
      }
      current += ch;
      units += charUnits;
    }
    if (current) parts.push(current);
    return parts;
  };

  const chunks = [];
  let current = '';
  let units = 0;

  for (const token of tokenizeLineForWrap(text)) {
    const tokenUnits = estimateTextUnits(token);
    const tokenIsWhitespace = /^[ \t]+$/.test(token);

    if (!current && tokenIsWhitespace) {
      continue;
    }

    if (current && units + tokenUnits > safeWidth) {
      if (PUNCTUATION_TOKEN_REGEX.test(token)) {
        current += token;
        units += tokenUnits;
        continue;
      }

      pushChunk(chunks, current);
      current = token.replace(/^[ \t]+/g, '');
      units = estimateTextUnits(current);

      if (current && units > safeWidth) {
        const parts = breakOverlongToken(current, safeWidth);
        current = '';
        units = 0;
        for (const part of parts) {
          if (estimateTextUnits(part) >= safeWidth) {
            pushChunk(chunks, part);
          } else if (!current) {
            current = part;
            units = estimateTextUnits(part);
          } else if (units + estimateTextUnits(part) <= safeWidth) {
            current += part;
            units += estimateTextUnits(part);
          } else {
            pushChunk(chunks, current);
            current = part;
            units = estimateTextUnits(part);
          }
        }
      }
      continue;
    }

    current += token;
    units += tokenUnits;
  }

  if (current || chunks.length === 0) {
    pushChunk(chunks, current);
  }
  if (chunks.length === 0) return [''];
  return chunks;
};

const wrapTextToPhysicalLines = (text, charsPerLine) => {
  const logicalLines = String(text || '').split('\n');
  const physicalLines = [];
  for (const line of logicalLines) {
    if (!line || !line.trim()) {
      physicalLines.push('');
      continue;
    }
    physicalLines.push(...wrapLineByVisualWidth(line, charsPerLine));
  }
  return physicalLines;
};

const FIRST_LINE_INDENT = '\u3000\u3000';
const TOP_LEVEL_SECTION_REGEX = /([^\n])\s*(?=([一二三四五六七八九十]{1,3}、))/g;
const SUB_LEVEL_SECTION_REGEX = /([^\n])\s*(?=([（(][一二三四五六七八九十]{1,3}[）)]))/g;
const NOTE_LINE_REGEX = /^\u6ce8[:\uff1a]/;
const TOP_LEVEL_SECTION_LINE_REGEX = /^[一二三四五六七八九十]{1,3}、/;
const SUB_SECTION_LINE_REGEX = /^[（(][一二三四五六七八九十]{1,3}[）)]/;
const NARRATIVE_WRAP_WIDTH_FACTOR = 0.9;

const insertSectionParagraphBreaks = (text, { splitSubSections = true } = {}) => {
  if (!text) return '';
  let normalized = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');

  normalized = normalized.replace(TOP_LEVEL_SECTION_REGEX, '$1\n');
  if (splitSubSections) {
    normalized = normalized.replace(SUB_LEVEL_SECTION_REGEX, '$1\n');
  }

  return normalized.replace(/\n{3,}/g, '\n\n').trim();
};

const formatParagraphIndent = (text, options = {}) => {
  const {
    splitSections = false,
    splitSubSections = true,
    indentSubSectionHeadings = false,
    indentTopLevelHeadings = false
  } = options;
  const input = splitSections
    ? insertSectionParagraphBreaks(text, { splitSubSections })
    : text;
  const normalized = String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return normalized
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/\s+$/g, '');
      const compact = trimmed.trimStart();
      if (!compact) return '';
      if (compact.startsWith(FIRST_LINE_INDENT) || compact.startsWith('  ')) return compact;
      if (NOTE_LINE_REGEX.test(compact)) return compact;
      if (!indentTopLevelHeadings && TOP_LEVEL_SECTION_LINE_REGEX.test(compact)) return compact;
      if (!indentSubSectionHeadings && SUB_SECTION_LINE_REGEX.test(compact)) return compact;
      return `${FIRST_LINE_INDENT}${compact}`;
    })
    .join('\n');
};

const resolveMergedSpan = (sheet, rowNumber, colNumber) => {
  const merges = Array.isArray(sheet?.model?.merges) ? sheet.model.merges : [];
  const rowIdx = rowNumber - 1;
  const colIdx = colNumber - 1;

  for (const mergeRef of merges) {
    let range;
    try {
      range = XLSX.utils.decode_range(mergeRef);
    } catch (error) {
      continue;
    }

    if (
      rowIdx >= range.s.r && rowIdx <= range.e.r
      && colIdx >= range.s.c && colIdx <= range.e.c
    ) {
      return {
        rows: range.e.r - range.s.r + 1,
        cols: range.e.c - range.s.c + 1
      };
    }
  }

  return { rows: 1, cols: 1 };
};

const findMergedRangeRef = (sheet, rowNumber, colNumber) => {
  const merges = Array.isArray(sheet?.model?.merges) ? sheet.model.merges : [];
  const rowIdx = rowNumber - 1;
  const colIdx = colNumber - 1;

  for (const mergeRef of merges) {
    let range;
    try {
      range = XLSX.utils.decode_range(mergeRef);
    } catch (error) {
      continue;
    }

    if (
      rowIdx >= range.s.r && rowIdx <= range.e.r
      && colIdx >= range.s.c && colIdx <= range.e.c
    ) {
      return mergeRef;
    }
  }
  return null;
};

const cloneValue = (value) => {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
};

const hasFont = (font) => !!(font && (font.name || font.size || font.bold || font.italic));

const findSheetBodyFont = (sheet, startRow = 1, startCol = 1, maxProbeRows = 30) => {
  const endRow = startRow + maxProbeRows;
  for (let rowNo = startRow; rowNo <= endRow; rowNo += 1) {
    const cell = sheet.getRow(rowNo).getCell(startCol);
    if (hasFont(cell.font)) {
      return cloneValue(cell.font);
    }
  }
  return null;
};

const copyCellStyleFromSource = ({ sourceCell, targetCell, templateFallbackFont }) => {
  if (!sourceCell || !targetCell) return;

  if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
  if (sourceCell.border && Object.keys(sourceCell.border).length > 0) {
    targetCell.border = cloneValue(sourceCell.border);
  }
  if (sourceCell.fill && Object.keys(sourceCell.fill).length > 0) {
    targetCell.fill = cloneValue(sourceCell.fill);
  }
  if (sourceCell.alignment && Object.keys(sourceCell.alignment).length > 0) {
    targetCell.alignment = cloneValue(sourceCell.alignment);
  }

  if (!hasFont(targetCell.font) && hasFont(templateFallbackFont)) {
    targetCell.font = cloneValue(templateFallbackFont);
  }
};

const cloneCellValue = (value) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map((item) => cloneCellValue(item));
  if (typeof value === 'object') return cloneValue(value);
  return value;
};

const isMeaningfulCellValue = (value) => {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return true;
  if (value instanceof Date) return true;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.some((part) => String(part?.text || '').trim() !== '');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return isMeaningfulCellValue(value.result);
    }
    return true;
  }
  return String(value).trim() !== '';
};

const resolveSheetUsedRange = (sheet) => {
  if (!sheet) return { maxRow: 1, maxCol: 1 };
  let maxRow = 0;
  let maxCol = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    let rowHasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!isMeaningfulCellValue(cell.value)) return;
      rowHasValue = true;
      if (colNumber > maxCol) maxCol = colNumber;
    });
    if (rowHasValue && rowNumber > maxRow) maxRow = rowNumber;
  });

  const merges = Array.isArray(sheet.model?.merges) ? sheet.model.merges : [];
  for (const mergeRef of merges) {
    let range;
    try {
      range = XLSX.utils.decode_range(mergeRef);
    } catch (error) {
      continue;
    }
    const topLeftCell = sheet.getRow(range.s.r + 1).getCell(range.s.c + 1);
    if (!isMeaningfulCellValue(topLeftCell.value)) continue;
    maxRow = Math.max(maxRow, range.e.r + 1);
    maxCol = Math.max(maxCol, range.e.c + 1);
  }

  if (maxRow <= 0) {
    maxRow = Math.max(1, sheet.actualRowCount || sheet.rowCount || 1);
  }
  if (maxCol <= 0) {
    maxCol = Math.max(1, sheet.actualColumnCount || sheet.columnCount || 1);
  }

  return { maxRow, maxCol };
};

const normalizeTableSheetLayout = (sheet, { endRowOverride = null } = {}) => {
  if (!sheet) return;
  const { maxRow, maxCol } = resolveSheetUsedRange(sheet);
  const endRow = Number.isFinite(endRowOverride) && endRowOverride > 0
    ? endRowOverride
    : maxRow;
  const endCol = XLSX.utils.encode_col(Math.max(0, maxCol - 1));
  const nextPageSetup = {
    ...sheet.pageSetup,
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    verticalCentered: false,
    printArea: `A1:${endCol}${endRow}`
  };
  delete nextPageSetup.scale;
  sheet.pageSetup = nextPageSetup;
};

const resolveLastMeaningfulRow = (sheet) => {
  if (!sheet) return 1;
  const { maxRow, maxCol } = resolveSheetUsedRange(sheet);
  const safeMaxCol = Math.max(1, maxCol);

  for (let rowNo = Math.max(1, maxRow); rowNo >= 1; rowNo -= 1) {
    const row = sheet.getRow(rowNo);
    let hasValue = false;
    for (let colNo = 1; colNo <= safeMaxCol; colNo += 1) {
      if (isMeaningfulCellValue(row.getCell(colNo).value)) {
        hasValue = true;
        break;
      }
    }
    if (hasValue) return rowNo;
  }

  return 1;
};

const normalizeNarrativeSheetLayout = (sheet, { minLastRow = 3 } = {}) => {
  if (!sheet) return;
  const { maxCol } = resolveSheetUsedRange(sheet);
  const endRow = Math.max(minLastRow, resolveLastMeaningfulRow(sheet));
  const endCol = XLSX.utils.encode_col(Math.max(0, maxCol - 1));
  const nextPageSetup = {
    ...sheet.pageSetup,
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    verticalCentered: false,
    printArea: `A1:${endCol}${endRow}`
  };
  delete nextPageSetup.scale;
  sheet.pageSetup = nextPageSetup;
};

const pruneSheetAfterRow = (sheet, lastRowToKeep) => {
  if (!sheet || !Number.isFinite(lastRowToKeep) || lastRowToKeep < 1) return;
  const merges = Array.isArray(sheet.model?.merges) ? [...sheet.model.merges] : [];
  for (const mergeRef of merges) {
    let range;
    try {
      range = XLSX.utils.decode_range(mergeRef);
    } catch (error) {
      continue;
    }
    const startRow = range.s.r + 1;
    const endRow = range.e.r + 1;
    if (startRow > lastRowToKeep || endRow > lastRowToKeep) {
      try {
        sheet.unMergeCells(mergeRef);
      } catch (error) {
        // Ignore invalid/unapplied merge refs.
      }
    }
  }

  if (sheet.rowCount > lastRowToKeep) {
    sheet.spliceRows(lastRowToKeep + 1, sheet.rowCount - lastRowToKeep);
  }

  // Excel template rows may still carry visual styles after splice.
  // Clear a safe trailing window to avoid ghost grid lines in PDF conversion.
  const clearColEnd = Math.max(7, Math.min(16, sheet.actualColumnCount || sheet.columnCount || 7));
  const clearRowEnd = Math.min(sheet.rowCount || lastRowToKeep, lastRowToKeep + 180);
  for (let rowNo = lastRowToKeep + 1; rowNo <= clearRowEnd; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    row.height = undefined;
    for (let colNo = 1; colNo <= clearColEnd; colNo += 1) {
      const cell = row.getCell(colNo);
      cell.value = null;
      cell.border = undefined;
      cell.fill = undefined;
    }
  }
};

const BUDGET_FORM_LABEL_MATCH_REGEX = /(?:单位|部门)预算\s*\d{2}\s*表/;
const BUDGET_FORM_LABEL_REPLACE_REGEX = /(?:单位|部门)预算\s*\d{2}\s*表/g;

const removeBudgetFormLabels = (sheet) => {
  if (!sheet) return;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = parseCellText(cell.value);
      if (!text || !BUDGET_FORM_LABEL_MATCH_REGEX.test(text)) return;
      const cleaned = text
        .replace(BUDGET_FORM_LABEL_REPLACE_REGEX, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      cell.value = cleaned || '';
    });
  });
};

const toNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasNonZeroNumber = (value) => {
  const num = toNumber(value);
  return Number.isFinite(num) && Math.abs(num) > 0.000001;
};

const removeDuplicateFiscalTotalRows = (sheet) => {
  if (!sheet) return;
  const { maxRow, maxCol } = resolveSheetUsedRange(sheet);
  const totalRows = [];
  const scanEnd = Math.min(maxRow + 8, 320);
  const safeMaxCol = Math.max(1, Math.min(maxCol, 12));

  for (let rowNo = 1; rowNo <= scanEnd; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const leftText = parseCellText(row.getCell(1).value).trim();
    const middleText = parseCellText(row.getCell(3).value).trim();
    if (leftText !== '收入总计' || middleText !== '支出总计') continue;
    const hasNumber = hasNonZeroNumber(row.getCell(2).value)
      || hasNonZeroNumber(row.getCell(4).value)
      || hasNonZeroNumber(row.getCell(5).value);
    totalRows.push({ rowNo, hasNumber });
  }

  if (totalRows.length <= 1) return;

  const keep = totalRows.find((item) => item.hasNumber) || totalRows[0];
  for (const item of totalRows) {
    if (item.rowNo === keep.rowNo) continue;
    const row = sheet.getRow(item.rowNo);
    for (let colNo = 1; colNo <= safeMaxCol; colNo += 1) {
      row.getCell(colNo).value = null;
    }
    row.height = undefined;
  }
};

const isPlaceholderDots = (text) => {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return false;
  return /^[.…·]+$/.test(normalized);
};

const cleanupEmptyCodeTableRows = (sheet, options = {}) => {
  if (!sheet) return;
  const { keepLastTotal = true, codeCols = 4 } = options;
  const { maxRow, maxCol } = resolveSheetUsedRange(sheet);
  const safeMaxCol = Math.max(1, Math.min(maxCol, 12));
  const inspectCodeCols = Math.max(1, Math.min(codeCols, safeMaxCol));
  const totalRows = [];

  const clearRow = (rowNo) => {
    const row = sheet.getRow(rowNo);
    for (let colNo = 1; colNo <= safeMaxCol; colNo += 1) {
      row.getCell(colNo).value = null;
    }
  };

  for (let rowNo = 1; rowNo <= maxRow; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const firstCellText = parseCellText(row.getCell(1).value).trim();
    if (firstCellText === '合计') {
      totalRows.push(rowNo);
    }

    let hasDots = false;
    let hasContent = false;
    for (let colNo = 1; colNo <= inspectCodeCols; colNo += 1) {
      const text = parseCellText(row.getCell(colNo).value).trim();
      if (!text) continue;
      if (isPlaceholderDots(text)) {
        hasDots = true;
      } else {
        hasContent = true;
      }
    }
    if (hasDots && !hasContent) {
      clearRow(rowNo);
    }
  }

  if (totalRows.length <= 1) return;
  const keepRowNo = keepLastTotal ? totalRows[totalRows.length - 1] : totalRows[0];
  for (const rowNo of totalRows) {
    if (rowNo === keepRowNo) continue;
    clearRow(rowNo);
  }
};

const normalizeEmptyCodeTableLayout = (sheet, options = {}) => {
  if (!sheet) return;
  const {
    dataStartRow = 9,
    dataEndRow = 20,
    totalRow = 21,
    colCount = 7,
    totalLabelMergeCols = 4
  } = options;

  const thinBlackBorder = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } }
  };

  const merges = Array.isArray(sheet.model?.merges) ? [...sheet.model.merges] : [];
  for (const mergeRef of merges) {
    let range;
    try {
      range = XLSX.utils.decode_range(mergeRef);
    } catch (error) {
      continue;
    }
    const rowStart = range.s.r + 1;
    const rowEnd = range.e.r + 1;
    const colStart = range.s.c + 1;
    const colEnd = range.e.c + 1;

    const inDataArea = rowStart <= dataEndRow && rowEnd >= dataStartRow;
    const overlapTotalCodeArea = rowStart <= totalRow
      && rowEnd >= totalRow
      && colStart <= totalLabelMergeCols
      && colEnd >= 1;

    if (!inDataArea && !overlapTotalCodeArea) continue;
    try {
      sheet.unMergeCells(mergeRef);
    } catch (error) {
      // Ignore invalid merge refs.
    }
  }

  // Data rows should be a clean empty grid.
  for (let rowNo = dataStartRow; rowNo <= dataEndRow; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    for (let colNo = 1; colNo <= colCount; colNo += 1) {
      const cell = row.getCell(colNo);
      cell.value = null;
      cell.border = cloneValue(thinBlackBorder);
    }
  }

  const total = sheet.getRow(totalRow);
  for (let colNo = 1; colNo <= colCount; colNo += 1) {
    const cell = total.getCell(colNo);
    cell.value = null;
    cell.border = cloneValue(thinBlackBorder);
  }
  total.getCell(1).value = '合计';

  try {
    const endCol = XLSX.utils.encode_col(Math.max(0, totalLabelMergeCols - 1));
    sheet.mergeCells(`A${totalRow}:${endCol}${totalRow}`);
  } catch (error) {
    // Ignore merge errors when already merged.
  }
};

/**
 * Helper to test if a table is visually empty (all check columns are zero/empty)
 */
const isTableEmpty = (sheet, checkCols = []) => {
  let hasData = false;
  sheet.eachRow((row, rowNumber) => {
    // Skip header rows (approx check)
    if (rowNumber < 6) return;
    for (const colIdx of checkCols) {
      const cell = row.getCell(colIdx);
      const val = cell.value;
      if (val !== null && val !== undefined && val !== '') {
        const num = Number(val);
        if (!Number.isNaN(num) && Math.abs(num) > 0.000001) {
          hasData = true;
        }
      }
    }
  });
  return !hasData;
};

/**
 * Helper to set an "Empty Table" note at the bottom
 */
const setEmptyTableNote = (sheet, noteText, mergeToCol = 7, options = {}) => {
  if (!sheet || !noteText) return;

  const {
    preferLastTotalRow = false,
    pruneAfterNote = true,
    outsideTable = false
  } = options;

  const { maxRow, maxCol } = resolveSheetUsedRange(sheet);
  let targetRowIdx = maxRow + 1;
  let firstTotalRowIdx = 0;
  let lastTotalRowIdx = 0;
  let noteRowIdx = 0;

  sheet.eachRow((row, rowNumber) => {
    const firstCellText = parseCellText(row.getCell(1).value).trim();
    if (firstCellText === '合计') {
      if (firstTotalRowIdx === 0) firstTotalRowIdx = rowNumber;
      lastTotalRowIdx = rowNumber;
    }
    if (firstCellText.match(/^注[:：]/)) {
      noteRowIdx = rowNumber;
    }
  });

  if (preferLastTotalRow && lastTotalRowIdx > 0) {
    targetRowIdx = lastTotalRowIdx + 1;
  } else if (noteRowIdx > 0) {
    targetRowIdx = noteRowIdx;
  } else if (firstTotalRowIdx > 0) {
    // Empty function tables may contain placeholder rows between duplicated totals.
    // Put note right after the first "合计" row to avoid keeping visual blank rows.
    targetRowIdx = firstTotalRowIdx + 1;
  }

  const safeMergeToCol = Math.max(1, Math.min(mergeToCol, maxCol));
  const row = sheet.getRow(targetRowIdx);
  const cell = row.getCell(1);
  const fallbackFont = findSheetBodyFont(sheet, 1, 1, 80);

  for (let colNo = 1; colNo <= safeMergeToCol; colNo += 1) {
    row.getCell(colNo).value = null;
  }

  cell.value = noteText;
  cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
  if (!hasFont(cell.font) && hasFont(fallbackFont)) {
    cell.font = cloneValue(fallbackFont);
  }

  try {
    sheet.mergeCells(targetRowIdx, 1, targetRowIdx, safeMergeToCol);
  } catch (e) {
    // Ignore merge errors
  }

  if (!outsideTable) {
    cell.border = {
      top: { style: 'thin', color: BLACK_FONT_COLOR },
      left: { style: 'thin', color: BLACK_FONT_COLOR },
      right: { style: 'thin', color: BLACK_FONT_COLOR },
      bottom: { style: 'thin', color: BLACK_FONT_COLOR }
    };
  } else {
    for (let colNo = 1; colNo <= safeMergeToCol; colNo += 1) {
      row.getCell(colNo).border = undefined;
      row.getCell(colNo).fill = undefined;
    }
  }

  const width = getColumnSpanWidth(sheet, 1, safeMergeToCol);
  adjustRowHeight(row, noteText, {
    charsPerLine: Math.max(14, Math.floor(width * 0.85)),
    minHeight: 22,
    maxHeight: 36,
    respectExistingHeight: false
  });

  if (pruneAfterNote) {
    // For empty tables, remove all rows below note to match official layout.
    pruneSheetAfterRow(sheet, targetRowIdx);
    normalizeTableSheetLayout(sheet, { endRowOverride: targetRowIdx });
    return;
  }

  normalizeTableSheetLayout(sheet);
};

const BLACK_FONT_COLOR = { argb: 'FF000000' };

const normalizeCellTextColorToBlack = (cell) => {
  if (!cell) return;

  const value = cell.value;
  if (value && typeof value === 'object' && Array.isArray(value.richText)) {
    cell.value = {
      ...value,
      richText: value.richText.map((part) => ({
        ...part,
        font: {
          ...(part.font || {}),
          color: BLACK_FONT_COLOR
        }
      }))
    };
  }

  if (cell.font) {
    cell.font = {
      ...cell.font,
      color: BLACK_FONT_COLOR
    };
  }
};

const applyCoverTypography = (sheet) => {
  if (!sheet) return;

  const coverTitleCell = sheet.getCell('A3');
  const coverUnitCell = sheet.getCell('A9');
  const applyMergedRangeTypography = (cellAddr, font, alignment) => {
    const cell = sheet.getCell(cellAddr);
    const rowNo = cell.row;
    const colNo = cell.col;
    let colStart = colNo;
    let colEnd = colNo;
    const mergeRef = findMergedRangeRef(sheet, rowNo, colNo);
    if (mergeRef) {
      try {
        const range = XLSX.utils.decode_range(mergeRef);
        colStart = range.s.c + 1;
        colEnd = range.e.c + 1;
      } catch (error) {
        colStart = colNo;
        colEnd = colNo;
      }
    }

    for (let c = colStart; c <= colEnd; c += 1) {
      const target = sheet.getRow(rowNo).getCell(c);
      target.font = cloneValue(font);
      target.alignment = {
        ...(target.alignment || {}),
        ...(alignment || {})
      };
    }
  };

  // Flatten rich text runs on cover title to avoid inherited red fragments in PDF.
  const coverTitleText = parseCellText(coverTitleCell.value).trim();
  const coverUnitText = parseCellText(coverUnitCell.value).trim();

  const coverTitleFont = {
    // Prefer widely-supported sans-serif bold to keep uniform stroke weight in PDF conversion.
    name: '\u9ed1\u4f53',
    size: 36,
    bold: true,
    charset: 134,
    color: BLACK_FONT_COLOR
  };
  const coverUnitFont = {
    name: '\u6977\u4f53_GB2312',
    size: 18,
    bold: false,
    charset: 134,
    color: BLACK_FONT_COLOR
  };

  coverTitleCell.value = coverTitleText
    ? {
      richText: Array.from(coverTitleText).map((ch) => ({
        text: ch,
        font: cloneValue(coverTitleFont)
      }))
    }
    : '';
  coverUnitCell.value = coverUnitText;

  applyMergedRangeTypography('A3', coverTitleFont, { horizontal: 'center', vertical: 'middle' });
  applyMergedRangeTypography('A9', coverUnitFont, { horizontal: 'center', vertical: 'middle' });

  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      normalizeCellTextColorToBlack(cell);
    });
  });
};

const applyDirectoryTypography = (sheet) => {
  if (!sheet) return;
  const titleCell = sheet.getCell('A1');
  titleCell.value = parseCellText(titleCell.value);
  titleCell.font = {
    name: '\u5b8b\u4f53',
    size: 20,
    bold: false,
    color: BLACK_FONT_COLOR
  };

  sheet.eachRow((row, rowNo) => {
    if (rowNo < 4) return;
    const cell = row.getCell(1);
    if (cell.value === null || cell.value === undefined || String(cell.value).trim() === '') return;
    cell.value = parseCellText(cell.value);
    cell.font = {
      name: '\u4eff\u5b8b_GB2312',
      size: 14,
      bold: false,
      color: BLACK_FONT_COLOR
    };
  });
};

const applyBodyTypography = (sheet) => {
  if (!sheet) return;
  sheet.eachRow((row, rowNo) => {
    if (rowNo < 3) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.font = {
        name: '\u5b8b\u4f53',
        size: 12,
        bold: false,
        color: BLACK_FONT_COLOR
      };
    });
  });
};

const applyNarrativeTitleAlignment = (sheet) => {
  if (!sheet) return;
  const titleCell = sheet.getCell('A1');
  const titleText = parseCellText(titleCell.value).trim();
  if (!titleText) return;

  titleCell.value = titleText;
  titleCell.alignment = {
    horizontal: 'center',
    vertical: 'middle'
  };
  titleCell.font = {
    ...(titleCell.font || {}),
    name: '\u5b8b\u4f53',
    size: 18,
    bold: false,
    color: BLACK_FONT_COLOR
  };

  const row = sheet.getRow(1);
  if (!Number.isFinite(row.height) || row.height < 24) {
    row.height = 24;
  }
  sheet.pageSetup = {
    ...(sheet.pageSetup || {}),
    horizontalCentered: true
  };
};

const BUDGET_EXPLANATION_TITLE_REGEX = /(?:单位|部门)?预算编制说明/;

const enforceBudgetExplanationTitleCenter = (workbook) => {
  if (!workbook) return;
  workbook.eachSheet((sheet) => {
    const titleCell = sheet.getCell('A1');
    const titleText = parseCellText(titleCell.value).trim();
    if (!titleText || !BUDGET_EXPLANATION_TITLE_REGEX.test(titleText)) return;

    titleCell.value = titleText;
    titleCell.alignment = {
      ...(titleCell.alignment || {}),
      horizontal: 'center',
      vertical: 'middle'
    };
    titleCell.font = {
      ...(titleCell.font || {}),
      name: '\u5b8b\u4f53',
      size: 18,
      bold: false,
      color: BLACK_FONT_COLOR
    };

    const row = sheet.getRow(1);
    if (!Number.isFinite(row.height) || row.height < 24) {
      row.height = 24;
    }

    sheet.pageSetup = {
      ...(sheet.pageSetup || {}),
      horizontalCentered: true,
      verticalCentered: false
    };
  });
};

const normalizeTextCellIndent = ({ sheet, cellAddr = 'A3', formatOptions = {} }) => {
  if (!sheet) return;
  const cell = sheet.getCell(cellAddr);
  const raw = parseCellText(cell.value);
  if (!raw) return;
  const formatted = formatParagraphIndent(raw, formatOptions);
  if (formatted === raw) return;
  cell.value = formatted;
};

const copyWholeTableSheetFromSource = ({ sourceSheet, targetSheet }) => {
  if (!sourceSheet || !targetSheet) return;
  const { maxRow, maxCol } = resolveSheetUsedRange(sourceSheet);
  if (maxRow <= 0 || maxCol <= 0) return;

  const existingMerges = Array.isArray(targetSheet.model?.merges) ? [...targetSheet.model.merges] : [];
  for (const mergeRef of existingMerges) {
    try {
      targetSheet.unMergeCells(mergeRef);
    } catch (error) {
      // ignore invalid/unapplied merge refs
    }
  }

  for (let colNo = 1; colNo <= maxCol; colNo += 1) {
    const sourceCol = sourceSheet.getColumn(colNo);
    const targetCol = targetSheet.getColumn(colNo);
    targetCol.width = sourceCol.width;
    targetCol.hidden = sourceCol.hidden;
    targetCol.outlineLevel = sourceCol.outlineLevel;
    if (sourceCol.style && Object.keys(sourceCol.style).length > 0) {
      targetCol.style = cloneValue(sourceCol.style);
    }
  }

  for (let rowNo = 1; rowNo <= maxRow; rowNo += 1) {
    const sourceRow = sourceSheet.getRow(rowNo);
    const targetRow = targetSheet.getRow(rowNo);
    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;
    if (sourceRow.style && Object.keys(sourceRow.style).length > 0) {
      targetRow.style = cloneValue(sourceRow.style);
    }

    for (let colNo = 1; colNo <= maxCol; colNo += 1) {
      const sourceCell = sourceRow.getCell(colNo);
      const targetCell = targetRow.getCell(colNo);

      targetCell.value = cloneCellValue(sourceCell.value);
      targetCell.numFmt = sourceCell.numFmt || undefined;
      targetCell.style = cloneValue(sourceCell.style || {});
    }
  }

  if (targetSheet.rowCount > maxRow) {
    targetSheet.spliceRows(maxRow + 1, targetSheet.rowCount - maxRow);
  }

  const sourceMerges = Array.isArray(sourceSheet.model?.merges)
    ? sourceSheet.model.merges
    : [];

  for (const mergeRef of sourceMerges) {
    try {
      targetSheet.mergeCells(mergeRef);
    } catch (error) {
      // ignore merge conflicts on malformed refs
    }
  }

  if (sourceSheet.pageSetup) targetSheet.pageSetup = cloneValue(sourceSheet.pageSetup);
  if (sourceSheet.properties) {
    targetSheet.properties = {
      ...targetSheet.properties,
      ...cloneValue(sourceSheet.properties)
    };
  }
  if (sourceSheet.headerFooter) targetSheet.headerFooter = cloneValue(sourceSheet.headerFooter);
  if (Array.isArray(sourceSheet.views) && sourceSheet.views.length > 0) {
    targetSheet.views = cloneValue(sourceSheet.views);
  }
};

const fillExcelTemplate = async ({ templatePath, sourcePath, outputPath, values, year, caliber = 'unit' }) => {
  if (!sourcePath) {
    throw new Error('sourcePath is required to fill Excel template');
  }

  const payload = buildPayload({ values, year, caliber });

  // 1. Read source workbook with ExcelJS and only accept modern workbook formats.
  const sourceExt = path.extname(sourcePath).toLowerCase();
  if (sourceExt !== '.xlsx' && sourceExt !== '.xlsm') {
    throw new Error('Only .xlsx/.xlsm source files are supported for template filling.');
  }
  const sourceWb = new ExcelJS.Workbook();
  await sourceWb.xlsx.readFile(sourcePath);

  // 2. Load template using ExcelJS (must be .xlsx)
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  // 3. Process Sheet Mapping
  for (const mapping of payload.sheetMap) {
    if (mapping.target === payload.sheetNames.explanation) continue;

    // Resolve source sheet name
    let sourceSheet = null;
    const candidates = mapping.sourceCandidates || (mapping.source ? [mapping.source] : []);

    for (const name of candidates) {
      const candidateSheet = sourceWb.getWorksheet(name);
      if (candidateSheet) {
        sourceSheet = candidateSheet;
        break;
      }
    }

    if (!sourceSheet) continue;

    const targetSheet = workbook.getWorksheet(mapping.target);

    if (!sourceSheet || !targetSheet) continue;
    const isTableSheet = payload.tableSheets.includes(mapping.target);

    if (isTableSheet) {
      copyWholeTableSheetFromSource({
        sourceSheet,
        targetSheet
      });
      continue;
    }

    const fallbackFont = findSheetBodyFont(targetSheet, 1, 1, 80);

    const { maxRow, maxCol } = resolveSheetUsedRange(sourceSheet);
    if (maxRow <= 0 || maxCol <= 0) continue;

    // Copy data cell by cell with formula+style support.
    for (let rowNo = 1; rowNo <= maxRow; rowNo += 1) {
      const sourceRow = sourceSheet.getRow(rowNo);
      for (let colNo = 1; colNo <= maxCol; colNo += 1) {
        const sourceCell = sourceRow.getCell(colNo);
        const targetRow = targetSheet.getRow(rowNo);
        const targetCell = targetRow.getCell(colNo);

        if (sourceCell.value !== null && sourceCell.value !== undefined) {
          targetCell.value = cloneCellValue(sourceCell.value);
          targetCell.numFmt = sourceCell.numFmt || undefined;
        }

        copyCellStyleFromSource({
          sourceCell,
          targetCell,
          templateFallbackFont: fallbackFont
        });
      }
    }
  }

  // 4. Update Year Wrappers
  const yearNum = Number(payload.year);
  const prevYearNum = Number(payload.prevYear);

  for (const sheetName of payload.yearUpdateSheets) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) continue;

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') {
          let val = cell.value;
          val = val
            .replace(/2026/g, '__CURR_YEAR__')
            .replace(/2025/g, '__PREV_YEAR__')
            .replace(/__CURR_YEAR__/g, String(yearNum))
            .replace(/__PREV_YEAR__/g, String(prevYearNum));

          val = val
            .replace(/比\s*20\d{2}\s*年预算/g, `比${prevYearNum}年预算`)
            .replace(/与\s*20\d{2}\s*年预算/g, `与${prevYearNum}年预算`)
            .replace(/较\s*20\d{2}\s*年预算/g, `较${prevYearNum}年预算`);

          if (/预算编制说明/.test(val) || /“三公”经费预算情况说明/.test(val) || /区级(?:单位|部门)?预算/.test(val)) {
            val = val.replace(/20\d{2}年/g, `${yearNum}年`);
          }
          if (val !== cell.value) cell.value = val;
        }
      });
    });
  }

  // 5. Build Directory Project Section
  const directorySheet = workbook.getWorksheet(payload.sheetNames.directory);
  if (directorySheet) {
    // Logic to ensure "Seven, Project Expense..." exists
    let exists = false;
    let sectionSixRow = 0;
    directorySheet.eachRow((row, rowNumber) => {
      const text = String(row.getCell(1).value || '').trim();
      if (text.includes('七、项目经费情况说明') || text.includes('七、 项目经费情况说明')) exists = true;
      if (text.includes('六、其他相关情况说明') || text.includes('六、 其他相关情况说明')) sectionSixRow = rowNumber;
    });

    if (!exists && sectionSixRow > 0) {
      const targetRow = directorySheet.getRow(sectionSixRow + 1);
      targetRow.getCell(1).value = '七、项目经费情况说明';
      targetRow.commit();
    }
    applyDirectoryTypography(directorySheet);
  }

  // 6. Cover Unit Text
  const coverSheet = workbook.getWorksheet(payload.sheetNames.cover);
  if (coverSheet) {
    if (payload.coverUnitText) {
      coverSheet.getCell('A9').value = payload.coverUnitText;
    }
    applyCoverTypography(coverSheet);
  }

  // 7. Manual Texts Block Writing
  const mergeSingleColumnRange = ({ sheet, rowStart, rowEnd, col }) => {
    if (!sheet || rowEnd < rowStart) return;
    const merges = Array.isArray(sheet.model?.merges) ? [...sheet.model.merges] : [];
    for (const mergeRef of merges) {
      let range;
      try {
        range = XLSX.utils.decode_range(mergeRef);
      } catch (error) {
        continue;
      }
      const mergeRowStart = range.s.r + 1;
      const mergeRowEnd = range.e.r + 1;
      const mergeColStart = range.s.c + 1;
      const mergeColEnd = range.e.c + 1;
      const overlapsRows = !(mergeRowEnd < rowStart || mergeRowStart > rowEnd);
      const overlapsCol = mergeColStart <= col && mergeColEnd >= col;
      if (overlapsRows && overlapsCol) {
        try {
          sheet.unMergeCells(mergeRef);
        } catch (error) {
          // Ignore invalid merge refs and continue.
        }
      }
    }

    if (rowEnd > rowStart) {
      try {
        sheet.mergeCells(rowStart, col, rowEnd, col);
      } catch (error) {
        // Ignore merge conflicts and continue best effort.
      }
    }
  };

  const setTextBlock = (sheetName, cellAddr, text, maxRows = 220, options = {}) => {
    const {
      splitSections = false,
      splitSubSections = true,
      indentSubSectionHeadings = false,
      indentTopLevelHeadings = false,
      minRows = 15,
      lineHeight = 20,
      forceLineLayout = false
    } = options;
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet || !text) return;

    const startCell = sheet.getCell(cellAddr);
    const startRow = startCell.row;
    const startCol = startCell.col;
    const templateFont = hasFont(startCell.font)
      ? cloneValue(startCell.font)
      : findSheetBodyFont(sheet, startRow, startCol, 40);
    const formattedText = formatParagraphIndent(text, {
      splitSections,
      splitSubSections,
      indentSubSectionHeadings,
      indentTopLevelHeadings
    });

    const baseSpan = resolveMergedSpan(sheet, startRow, startCol);
    const firstWidth = getColumnSpanWidth(sheet, startCol, Math.max(1, baseSpan.cols));
    const charsPerLine = Math.max(12, Math.floor(firstWidth * NARRATIVE_WRAP_WIDTH_FACTOR));
    const physicalLines = wrapTextToPhysicalLines(formattedText, charsPerLine);
    const useMergedLayout = !forceLineLayout && baseSpan.cols === 1 && baseSpan.rows > 1;

    if (!useMergedLayout) {
      const mergeRef = findMergedRangeRef(sheet, startRow, startCol);
      if (mergeRef) {
        try {
          sheet.unMergeCells(mergeRef);
        } catch (error) {
          // Ignore invalid merge refs and continue.
        }
      }

      const writeCount = Math.min(maxRows, Math.max(1, physicalLines.length));
      for (let idx = 0; idx < writeCount; idx += 1) {
        const rowNo = startRow + idx;
        const row = sheet.getRow(rowNo);
        const cell = row.getCell(startCol);
        cell.value = physicalLines[idx];
        cell.alignment = { wrapText: false, vertical: 'top', horizontal: 'left' };
        if (!hasFont(cell.font) && hasFont(templateFont)) {
          cell.font = cloneValue(templateFont);
        }
        row.height = lineHeight;
      }

      const clearStart = startRow + writeCount;
      const clearEnd = Math.min(sheet.actualRowCount, startRow + maxRows - 1);
      for (let rowNo = clearStart; rowNo <= clearEnd; rowNo += 1) {
        const cell = sheet.getRow(rowNo).getCell(startCol);
        if (cell.value !== null && cell.value !== undefined) {
          cell.value = null;
        }
      }

      normalizeNarrativeSheetLayout(sheet, {
        minLastRow: Math.max(startRow, startRow + writeCount - 1)
      });
      return;
    }

    const minRowsByTemplate = Math.max(1, baseSpan.rows);
    const targetRows = Math.max(
      minRowsByTemplate,
      minRows,
      Math.min(maxRows, Math.max(1, physicalLines.length + 1))
    );
    const endRow = startRow + targetRows - 1;

    mergeSingleColumnRange({
      sheet,
      rowStart: startRow,
      rowEnd: endRow,
      col: startCol
    });

    const startCellAfterMerge = sheet.getCell(cellAddr);
    startCellAfterMerge.value = formattedText;
    startCellAfterMerge.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
    if (!hasFont(startCellAfterMerge.font) && hasFont(templateFont)) {
      startCellAfterMerge.font = cloneValue(templateFont);
    }

    for (let rowNo = startRow; rowNo <= endRow; rowNo += 1) {
      sheet.getRow(rowNo).height = lineHeight;
    }

    const clearEnd = Math.min(sheet.actualRowCount, startRow + maxRows - 1);
    for (let rowNo = endRow + 1; rowNo <= clearEnd; rowNo += 1) {
      const cell = sheet.getRow(rowNo).getCell(startCol);
      if (cell.value !== null && cell.value !== undefined) {
        cell.value = null;
      }
    }

    normalizeNarrativeSheetLayout(sheet, { minLastRow: endRow });
  };

  const setExplanationBlocks = (sheetName, introText, lineItems = []) => {
    const intro = String(introText || '').trim();
    const detail = Array.isArray(lineItems)
      ? lineItems.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const mergedText = [intro, ...detail].filter(Boolean).join('\n');
    if (!mergedText) return;
    setTextBlock(sheetName, 'A3', mergedText, 900, {
      splitSections: false,
      splitSubSections: true,
      indentSubSectionHeadings: false,
      minRows: 18,
      lineHeight: 20
    });
  };

  const projectSheetText = String(payload.manualTexts.project_expense || '')
    .replace(/^\s*七、项目经费情况说明\s*\n?/u, '');

  setTextBlock(payload.sheetNames.functions, 'A3', payload.manualTexts.main_functions, 400, {
    forceUnmergeVertical: true,
    indentTopLevelHeadings: true,
    minRowHeight: 18,
    maxRowHeight: 44,
    lineHeight: 20,
    uniformLineHeight: true,
    respectExistingHeight: false
  });
  setTextBlock(payload.sheetNames.org, 'A3', payload.manualTexts.organizational_structure, 400, {
    forceUnmergeVertical: true,
    minRowHeight: 18,
    maxRowHeight: 44,
    lineHeight: 20,
    uniformLineHeight: true,
    respectExistingHeight: false
  });
  setTextBlock(payload.sheetNames.glossary, 'A3', payload.manualTexts.glossary, 220, {
    indentSubSectionHeadings: true,
    forceUnmergeVertical: true,
    minRowHeight: 20,
    maxRowHeight: 36,
    lineHeight: 20,
    uniformLineHeight: true,
    respectExistingHeight: false
  });
  setTextBlock(payload.sheetNames.other, 'A3', payload.manualTexts.other_notes, 800, {
    splitSections: true,
    splitSubSections: true,
    forceUnmergeVertical: true,
    minRowHeight: 18,
    maxRowHeight: 56,
    lineHeight: 20,
    uniformLineHeight: true,
    respectExistingHeight: false
  });
  setTextBlock(payload.sheetNames.project, 'A3', projectSheetText, 600, {
    splitSections: true,
    splitSubSections: false,
    forceUnmergeVertical: true,
    minRowHeight: 18,
    maxRowHeight: 44,
    lineHeight: 20,
    uniformLineHeight: true,
    respectExistingHeight: false
  });
  setExplanationBlocks(payload.sheetNames.explanation, payload.manualTexts.explanation_block, payload.lineItemLines);

  [
    payload.sheetNames.functions,
    payload.sheetNames.org,
    payload.sheetNames.glossary,
    payload.sheetNames.other,
    payload.sheetNames.project,
    payload.sheetNames.explanation
  ].forEach((sheetName) => {
    const sheet = workbook.getWorksheet(sheetName);
    const isGlossarySheet = sheetName === payload.sheetNames.glossary;
    const isFunctionsSheet = sheetName === payload.sheetNames.functions;
    normalizeTextCellIndent({
      sheet,
      cellAddr: 'A3',
      formatOptions: isGlossarySheet
        ? { indentSubSectionHeadings: true }
        : (isFunctionsSheet ? { indentTopLevelHeadings: true } : {})
    });
    applyBodyTypography(sheet);
    applyNarrativeTitleAlignment(sheet);
  });

  // 8. Unit Name Replacement Globally
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value !== 'string') return;
        let val = cell.value;
        val = val.replace(/XX(?:（单位）|\(单位\)|（部门）|\(部门\))?项目经费情况说明/g, '项目经费情况说明');
        if (payload.unitName) {
          val = val.replace(/XX（单位）/g, payload.unitName)
            .replace(/XX\(单位\)/g, payload.unitName)
            .replace(/XX（部门）/g, payload.unitName)
            .replace(/XX\(部门\)/g, payload.unitName);
        }
        if (val !== cell.value) cell.value = val;
      });
    });
  });

  const fiscalGrantSheetName = payload.caliber === 'department'
    ? '部门财政拨款收支总表'
    : '单位财政拨款收支总表';
  const fiscalGrantSheet = workbook.getWorksheet(fiscalGrantSheetName);
  if (fiscalGrantSheet) {
    removeDuplicateFiscalTotalRows(fiscalGrantSheet);
  }

  payload.tableSheets.forEach((sheetName) => {
    const tableSheet = workbook.getWorksheet(sheetName);
    if (!tableSheet) return;
    normalizeTableSheetLayout(tableSheet);
    removeBudgetFormLabels(tableSheet);
  });

  // 10. Empty Table Notes
  // Government Fund
  const govSheet = workbook.getWorksheet(payload.sheetNames.tableGovFund);
  if (govSheet && isTableEmpty(govSheet, [5, 6, 7])) { // Approx cols check
    cleanupEmptyCodeTableRows(govSheet);
    normalizeEmptyCodeTableLayout(govSheet);
    setEmptyTableNote(
      govSheet,
      `注:本${payload.subjectLabel}${payload.year}年无政府性基金预算财政拨款安排的预算，故本表为空表。`,
      7,
      { preferLastTotalRow: true, pruneAfterNote: true, outsideTable: true }
    );
  }

  // Capital Fund
  const capSheet = workbook.getWorksheet(payload.sheetNames.tableCapital);
  if (capSheet && isTableEmpty(capSheet, [5, 6, 7])) {
    cleanupEmptyCodeTableRows(capSheet);
    normalizeEmptyCodeTableLayout(capSheet);
    setEmptyTableNote(
      capSheet,
      `注:本${payload.subjectLabel}${payload.year}年无国有资本经营预算财政拨款安排的预算，故本表为空表。`,
      7,
      { preferLastTotalRow: true, pruneAfterNote: true, outsideTable: true }
    );
  }

  // Three Public
  const threePublicSheet = workbook.getWorksheet(payload.sheetNames.tableThreePublic);
  if (threePublicSheet && isTableEmpty(threePublicSheet, [1, 2, 3, 4, 5, 6])) {
    setEmptyTableNote(threePublicSheet, `注:本${payload.subjectLabel}${payload.year}年无“三公”经费和机关运行经费预算，故本表为空表。`);
  }

  [
    payload.sheetNames.functions,
    payload.sheetNames.org,
    payload.sheetNames.glossary,
    payload.sheetNames.other,
    payload.sheetNames.project,
    payload.sheetNames.explanation
  ].forEach((sheetName) => {
    normalizeNarrativeSheetLayout(workbook.getWorksheet(sheetName), { minLastRow: 3 });
  });

  enforceBudgetExplanationTitleCenter(workbook);

  // Save
  await workbook.xlsx.writeFile(outputPath);
};

module.exports = { fillExcelTemplate };
module.exports.__private = {
  buildPayload,
  buildProjectExpenseBlock,
  insertSectionParagraphBreaks,
  formatParagraphIndent,
  resolveSheetUsedRange,
  setEmptyTableNote,
  cleanupEmptyCodeTableRows,
  normalizeEmptyCodeTableLayout
};
