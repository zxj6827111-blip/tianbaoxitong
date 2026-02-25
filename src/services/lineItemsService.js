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

const toFiniteNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
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

  const fromPrevAmount = trimmed.match(/上年[:：]\s*[-+]?[\d.,]+\s*万元?[，,]?\s*(.+)$/);
  if (fromPrevAmount && fromPrevAmount[1]) {
    return fromPrevAmount[1]
      .replace(/^主要(?:原因是|用于)?[:：]?\s*/, '')
      .replace(/[。.]$/g, '')
      .trim();
  }

  const lastComma = Math.max(trimmed.lastIndexOf('，'), trimmed.lastIndexOf(','));
  if (lastComma !== -1 && lastComma < trimmed.length - 1) {
    return trimmed.slice(lastComma + 1).replace(/[。.]$/g, '').trim();
  }

  return trimmed.replace(/[。.]$/g, '').trim();
};

const isAutoComposedReasonText = (text) => {
  if (!text) return false;
  const trimmed = String(text).trim();
  if (!trimmed) return false;

  const hasAmountWithPrev = /[-+]?[\d.,]+\s*万元[，,]?\s*上年[:：]\s*[-+]?[\d.,]+\s*万元/.test(trimmed);
  if (!hasAmountWithPrev) return false;

  const hasAutoPrefix = /^["“]/.test(trimmed) || trimmed.includes('（项）');
  const hasAutoTail = /[，,]\s*主要/.test(trimmed);
  return hasAutoPrefix || hasAutoTail;
};

const normalizeReasonTextForInput = (text) => {
  if (text === null || text === undefined) {
    return null;
  }
  const trimmed = String(text).trim();
  if (!trimmed) {
    return '';
  }
  if (isAutoComposedReasonText(trimmed)) {
    const snippet = extractReasonSnippet(trimmed);
    return snippet || trimmed;
  }
  return trimmed;
};

const buildLineItemLabel = ({ itemName, className, typeName }) => {
  if (!itemName) return '';
  const parts = [];
  if (className) parts.push(`${className}（类）`);
  if (typeName) parts.push(`${typeName}（款）`);
  parts.push(`${itemName}（项）`);
  return parts.join('');
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

const REASON_ITEM_START_REGEX = /^\d+\s*[.．、]/;
const REASON_BOUNDARY_HINTS = [
  '预算单位财务收支预算总表',
  '预算单位收入预算总表',
  '预算单位支出预算总表',
  '预算单位财政拨款收支预算总表',
  '预算单位一般公共预算',
  '预算单位政府性基金预算',
  '预算单位国有资本经营预算',
  '预算单位“三公”经费和机关运行经费预算表',
  '编制单位',
  '功能分类科目编码',
  '收入总计',
  '支出总计'
];

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

const looksLikeTableRow = (line) => {
  const trimmed = normalizeLine(line);
  if (!trimmed) return false;
  if (/^\d{3}\s+\d{2}(?:\s+\d{2})?\s+/.test(trimmed)) return true;
  if (/^(合计|收入总计|支出总计)\s*/.test(trimmed)) return true;
  if (/^(本年收入|本年支出|项目|预算数|小计|购置费|运行费)\s*/.test(trimmed)) return true;
  return false;
};

const isReasonListBoundary = (line) => {
  if (!line) return false;
  if (looksLikeSectionHeading(line)) return true;
  if (REASON_BOUNDARY_HINTS.some((hint) => line.includes(hint))) return true;
  if (looksLikeTableRow(line)) return true;
  return false;
};

const isReasonNarrativeLine = (line) => {
  if (!line) return false;
  return line.includes('科目') || line.includes('主要用于') || line.includes('主要原因') || line.includes('（项）');
};

const extractLineItemReasonLines = (text) => {
  if (!text) return [];
  const cleaned = text.replace(PAGE_MARKER_REGEX, '');
  const lines = cleaned.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const startIndex = lines.findIndex((line) => line.includes('财政拨款支出主要内容'));
  if (startIndex === -1) return [];

  const result = [];
  let current = '';
  const headerLine = lines[startIndex];
  const headerParts = headerLine.split(/：|:/);
  if (headerParts.length > 1) {
    const remainder = headerParts.slice(1).join('：').trim();
    if (remainder) {
      current = remainder;
    }
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (isReasonListBoundary(line)) {
      if (current) {
        result.push(current);
        current = '';
      }
      if (result.length > 0) {
        break;
      }
      continue;
    }

    if (REASON_ITEM_START_REGEX.test(line)) {
      if (current) {
        result.push(current);
      }
      current = line;
      continue;
    }

    if (current) {
      // Continuation line: PDF extraction often wraps one item across multiple rows.
      current = `${current}${line}`;
      continue;
    }

    if (line.includes('科目') && line.includes('主要')) {
      current = line;
    }
  }

  if (current) {
    result.push(current);
  }

  return result
    .map(normalizeLine)
    .filter((line) => line && isReasonNarrativeLine(line));
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
      normalized: normalizeName(withoutAmounts),
      hasNarrativeKeyword: isReasonNarrativeLine(line)
    };
  }).filter((candidate) => candidate.normalized && candidate.hasNarrativeKeyword);

  items.forEach((item) => {
    const name = item.name || '';
    const code = item.code || '';
    const className = item.class_name || '';
    const typeName = item.type_name || '';
    const normalizedLabel = normalizeName(item.label || '');
    const normalizedName = normalizeName(name);
    let bestLine = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    normalizedLines.forEach((candidate) => {
      const hasCode = code && candidate.line.includes(code);
      const fullLabelMatch = normalizedLabel && candidate.normalized.includes(normalizedLabel);
      const nameMatch = normalizedName && candidate.normalized.includes(normalizedName);
      const classMatch = className && candidate.line.includes(className);
      const typeMatch = typeName && candidate.line.includes(typeName);

      if (!hasCode && !fullLabelMatch && !nameMatch) return;
      if (!hasCode && !fullLabelMatch && !classMatch && !typeMatch) {
        return;
      }

      let score = 0;
      if (hasCode) score += 1200;
      if (fullLabelMatch) score += 900;
      if (nameMatch) score += 300;
      if (classMatch) score += 250;
      if (typeMatch) score += 250;
      if (candidate.line.includes('主要用于') || candidate.line.includes('主要原因')) score += 120;
      if (candidate.line.includes('科目')) score += 80;
      score -= Math.min(candidate.line.length, 400) / 200;

      if (score > bestScore || (score === bestScore && (!bestLine || candidate.line.length < bestLine.length))) {
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

const FISCAL_REASON_REF_TABLE_KEYS = new Set(['general_budget', 'gov_fund_budget', 'capital_budget']);
const FISCAL_REASON_SENTENCE_END_REGEX = /[。；;!?？！]$/;
const FISCAL_REASON_SECTION_BREAK_KEYWORDS = [
  '名词解释',
  '机关运行经费',
  '政府采购',
  '国有资产',
  '预算绩效',
  '三公经费',
  '其他说明',
  '项目支出绩效',
  '部门收支总体情况',
  '部门收入总体情况',
  '部门支出总体情况'
];
const FISCAL_REASON_TABLE_START_KEYWORDS = [
  '编制部门',
  '单位：',
  '单位:',
  '本年收入',
  '本年支出',
  '收入预算',
  '支出预算',
  '功能分类科目名称',
  '财政拨款收入',
  '财政拨款支出',
  '三公经费',
  '机关运行经费'
];
const FISCAL_REASON_AMOUNT_REGEX = /[-+]?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:亿元|万元|元)/;
const FISCAL_REASON_HEADING_PREFIX_REGEX = /^(?:[一二三四五六七八九十百零〇\d]+[、.．]|第[一二三四五六七八九十百零〇\d]+(?:部分|章|节))/;
const FISCAL_REASON_IGNORED_PATTERNS = [
  /(?:19|20)?\d{0,2}年?(?:部门|单位)?财务收支预算总表/,
  /(?:19|20)?\d{0,2}年?(?:部门|单位)?(?:财政拨款)?收支预算总表/,
  /(?:19|20)?\d{0,2}年?(?:部门|单位)(?:收入|支出)预算总表/
];

const FISCAL_CN_DIGIT_MAP = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const FISCAL_CN_UNIT_MAP = {
  十: 10,
  百: 100
};

const normalizeFiscalReasonText = (value) => String(value || '')
  .replace(/[\s“”"'`]/g, '')
  .replace(/[（）()【】[\]、，。,:：；;·]/g, '')
  .trim();

const normalizeFiscalReasonCode = (value) => String(value || '').replace(/\D/g, '').trim();

const isIgnoredFiscalReasonLine = (value) => {
  const normalized = normalizeFiscalReasonText(value);
  if (!normalized) return false;
  return FISCAL_REASON_IGNORED_PATTERNS.some((pattern) => pattern.test(normalized));
};

const parseFiscalChineseIndex = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  let total = 0;
  let current = 0;

  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(FISCAL_CN_DIGIT_MAP, ch)) {
      current = FISCAL_CN_DIGIT_MAP[ch];
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(FISCAL_CN_UNIT_MAP, ch)) {
      const unit = FISCAL_CN_UNIT_MAP[ch];
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
      continue;
    }

    return null;
  }

  total += current;
  return total > 0 ? total : null;
};

const getFiscalReasonLineIndex = (line) => {
  const text = String(line || '').trim();
  if (!text) return null;

  const arabicPatterns = [
    /^([（(]?\d{1,3}[）)]?[、.．]?)\s*/,
    /^(\d{1,3}[、.．])\s*/
  ];

  for (const pattern of arabicPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const remainder = text.slice(match[0].length).trim();
    if (/^年/.test(remainder)) continue;
    const numeric = Number(match[1].replace(/[^\d]/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) {
      return { index: numeric, prefix: match[0] };
    }
  }

  const chinesePatterns = [
    /^([（(]?[一二三四五六七八九十百零〇]{1,5}[）)]?[、.．]?)\s*/,
    /^([一二三四五六七八九十百零〇]{1,5}[、.．])\s*/
  ];

  for (const pattern of chinesePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const remainder = text.slice(match[0].length).trim();
    if (/^年/.test(remainder)) continue;
    const normalized = match[1].replace(/[（()）)、.．\s]/g, '');
    const numeric = parseFiscalChineseIndex(normalized);
    if (numeric) {
      return { index: numeric, prefix: match[0] };
    }
  }

  return null;
};

const stripFiscalReasonLinePrefix = (line) => {
  const indexed = getFiscalReasonLineIndex(line);
  if (indexed) {
    return String(line || '').slice(indexed.prefix.length).trim();
  }
  return String(line || '').trim();
};

const appendFiscalReasonContinuation = (base, extra) =>
  `${String(base || '').trim()}${String(extra || '').trim()}`.replace(/\s+/g, '').trim();

const collectFiscalReasonClassAndTypeNames = (rows) => {
  const classNameMap = new Map();
  const typeNameMap = new Map();

  rows.forEach((row) => {
    const classCode = String(row.class_code || '').trim();
    const typeCode = String(row.type_code || '').trim();
    const itemCode = String(row.item_code || '').trim();
    const itemName = String(row.item_name || '').trim();
    if (!itemName || isIgnoredFiscalReasonLine(itemName)) return;

    if (classCode && !typeCode && !itemCode && !classNameMap.has(classCode)) {
      classNameMap.set(classCode, itemName);
      return;
    }

    if (classCode && typeCode && !itemCode && !typeNameMap.has(`${classCode}-${typeCode}`)) {
      typeNameMap.set(`${classCode}-${typeCode}`, itemName);
    }
  });

  return { classNameMap, typeNameMap };
};

const buildFiscalReasonLineItemReferences = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const filteredRows = rows.filter((row) => FISCAL_REASON_REF_TABLE_KEYS.has(String(row.table_key || '').trim()));
  if (filteredRows.length === 0) return [];

  const { classNameMap, typeNameMap } = collectFiscalReasonClassAndTypeNames(filteredRows);
  const seen = new Set();
  const references = [];

  filteredRows.forEach((row) => {
    const classCode = String(row.class_code || '').trim();
    const typeCode = String(row.type_code || '').trim();
    const itemCode = String(row.item_code || '').trim();
    const itemName = String(row.item_name || '').trim();
    if (!classCode || !typeCode || !itemCode || !itemName) return;
    if (isIgnoredFiscalReasonLine(itemName)) return;

    const className = String(classNameMap.get(classCode) || '').trim();
    const typeName = String(typeNameMap.get(`${classCode}-${typeCode}`) || '').trim();
    if (!className && !typeName) return;

    const normalizedClass = normalizeFiscalReasonText(className);
    const normalizedType = normalizeFiscalReasonText(typeName);
    const normalizedItem = normalizeFiscalReasonText(itemName);
    if (!normalizedItem) return;

    const signature = `${normalizedClass}|${normalizedType}|${normalizedItem}`;
    if (seen.has(signature)) return;
    seen.add(signature);

    const normalizedClassCode = normalizeFiscalReasonCode(classCode);
    const normalizedTypeCode = normalizeFiscalReasonCode(typeCode);
    const normalizedItemCode = normalizeFiscalReasonCode(itemCode);

    references.push({
      classCode: normalizedClassCode,
      typeCode: normalizedTypeCode,
      itemCode: normalizedItemCode,
      combinedCode: `${normalizedClassCode}${normalizedTypeCode}${normalizedItemCode}`,
      className,
      typeName,
      itemName,
      normalizedClass,
      normalizedType,
      normalizedItem
    });
  });

  return references;
};

const inferFiscalReasonLevelsByReference = (item, lineItemRefs) => {
  if (!lineItemRefs.length) return item;

  const hasClass = Boolean(String(item.className || '').trim());
  const hasType = Boolean(String(item.typeName || '').trim());
  if (hasClass && hasType) return item;

  const sourceName = String(item.itemName || '').trim();
  if (!sourceName || isIgnoredFiscalReasonLine(sourceName)) return item;

  const codeAndNameMatch = sourceName.match(/^(\d{6,9})(?:\s+|[-—－_/／]*)?(.*)$/);
  const sourceCode = normalizeFiscalReasonCode(codeAndNameMatch?.[1] || '');
  const sourceNameWithoutCode = codeAndNameMatch ? String(codeAndNameMatch[2] || '').trim() : '';

  if (sourceCode) {
    const codeMatchedRef = lineItemRefs.find((ref) => {
      if (!ref.combinedCode) return false;
      return sourceCode === ref.combinedCode || sourceCode.endsWith(ref.combinedCode);
    });
    if (codeMatchedRef) {
      return {
        ...item,
        className: hasClass ? item.className : codeMatchedRef.className,
        typeName: hasType ? item.typeName : codeMatchedRef.typeName,
        itemName: sourceNameWithoutCode || codeMatchedRef.itemName
      };
    }
  }

  const normalizedSource = normalizeFiscalReasonText(sourceName);
  if (!normalizedSource) return item;
  const normalizedSourceWithoutCode = sourceNameWithoutCode ? normalizeFiscalReasonText(sourceNameWithoutCode) : '';
  const normalizedCandidates = [{ value: normalizedSource, strippedCode: false }];
  if (normalizedSourceWithoutCode && normalizedSourceWithoutCode !== normalizedSource) {
    normalizedCandidates.push({ value: normalizedSourceWithoutCode, strippedCode: true });
  }

  const sourceNameForSegment = sourceNameWithoutCode || sourceName;
  const sourceSegments = sourceNameForSegment
    .split(/[-—－_/／]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (sourceSegments.length >= 2) {
    const normalizedClassPart = normalizeFiscalReasonText(sourceSegments[0]);
    const normalizedTypePart = normalizeFiscalReasonText(sourceSegments[1]);
    const segmentedMatch = lineItemRefs.find((ref) => (
      (!normalizedClassPart || ref.normalizedClass.includes(normalizedClassPart) || normalizedClassPart.includes(ref.normalizedClass))
      && (!normalizedTypePart || ref.normalizedType.includes(normalizedTypePart) || normalizedTypePart.includes(ref.normalizedType))
    ));

    if (segmentedMatch) {
      const inferredItemName = sourceSegments.length >= 3
        ? sourceSegments.slice(2).join('-')
        : item.itemName;
      return {
        ...item,
        className: hasClass ? item.className : segmentedMatch.className,
        typeName: hasType ? item.typeName : segmentedMatch.typeName,
        itemName: inferredItemName || segmentedMatch.itemName
      };
    }
  }

  let bestRef = null;
  let bestScore = 0;
  let bestUsedStrippedCode = false;

  lineItemRefs.forEach((ref) => {
    normalizedCandidates.forEach((candidate) => {
      const hasItem = Boolean(ref.normalizedItem) && candidate.value.includes(ref.normalizedItem);
      const hasClassToken = Boolean(ref.normalizedClass) && candidate.value.includes(ref.normalizedClass);
      const hasTypeToken = Boolean(ref.normalizedType) && candidate.value.includes(ref.normalizedType);
      if (!hasItem && !hasClassToken && !hasTypeToken) return;

      let score = 0;
      if (hasItem) score += candidate.strippedCode ? 140 : 100;
      if (hasClassToken) score += 70;
      if (hasTypeToken) score += 90;
      if (candidate.value === ref.normalizedItem) score += 120;
      if (candidate.strippedCode && hasItem) score += 40;
      if (hasItem && hasTypeToken) score += 80;
      if (hasItem && hasClassToken) score += 40;

      if (score > bestScore) {
        bestScore = score;
        bestRef = ref;
        bestUsedStrippedCode = candidate.strippedCode;
      }
    });
  });

  if (!bestRef || bestScore < 150) return item;
  const matchedItemByName = normalizedCandidates.some(
    (candidate) => Boolean(bestRef.normalizedItem) && candidate.value.includes(bestRef.normalizedItem)
  );

  return {
    ...item,
    className: hasClass ? item.className : bestRef.className,
    typeName: hasType ? item.typeName : bestRef.typeName,
    itemName: bestUsedStrippedCode && sourceNameWithoutCode
      ? sourceNameWithoutCode
      : (matchedItemByName ? bestRef.itemName : item.itemName)
  };
};

const shouldStopFiscalReasonParsing = (line) => {
  const trimmed = String(line || '').replace(/\s+/g, '').trim();
  if (!trimmed) return false;
  if (trimmed.includes('财政拨款支出主要内容如下')) return false;
  if (trimmed.includes('（类）') || trimmed.includes('（款）') || trimmed.includes('（项）')) return false;
  if (trimmed.includes('用于')) return false;

  const hasSentencePunctuation = /[，。；;：:]/.test(trimmed);
  const hasAmount = FISCAL_REASON_AMOUNT_REGEX.test(trimmed);
  const isHeadingLike = FISCAL_REASON_HEADING_PREFIX_REGEX.test(trimmed) || /^202\d年.*预算.*(?:说明|表)/.test(trimmed);
  const hasBreakKeyword = FISCAL_REASON_SECTION_BREAK_KEYWORDS.some((keyword) => trimmed.includes(keyword));
  const hasTableStartKeyword = FISCAL_REASON_TABLE_START_KEYWORDS.some((keyword) => trimmed.includes(keyword));

  if (hasTableStartKeyword && !trimmed.includes('主要用于')) return true;
  if (hasBreakKeyword && isHeadingLike) return true;
  if (hasBreakKeyword && !hasSentencePunctuation && trimmed.length <= 18) return true;
  if (isHeadingLike && !hasSentencePunctuation && !hasAmount && trimmed.length <= 24) return true;
  return false;
};

const parseFiscalReasonLevels = (detail) => {
  let rest = String(detail || '').trim();
  let className = '';
  let typeName = '';
  let itemName = '';

  const takeLevel = (marker) => {
    const match = rest.match(new RegExp(`^(.*?)[（(]${marker}[)）]`));
    if (!match) return '';
    const value = match[1].trim();
    rest = rest.slice(match[0].length).trim();
    return value;
  };

  className = takeLevel('类');
  typeName = takeLevel('款');
  itemName = takeLevel('项');
  if (!itemName && rest) itemName = rest;
  if (!className && !typeName && !itemName) itemName = String(detail || '').trim();

  return { className, typeName, itemName };
};

const parseSingleFiscalReasonItem = (line) => {
  const cleaned = stripFiscalReasonLinePrefix(line);
  if (!cleaned) return null;
  if (/^财政拨款支出主要内容如下[:：]?$/.test(cleaned)) return null;
  if (isIgnoredFiscalReasonLine(cleaned)) return null;

  let detailPart = cleaned;
  let purpose = '';

  const purposeMatch = detailPart.match(/^(.*?)(?:[：:]\s*)?((?:主要)?用于.*)$/);
  if (purposeMatch) {
    detailPart = purposeMatch[1].replace(/[，,:：\s]+$/, '').trim();
    purpose = purposeMatch[2].trim().replace(/^主要用于/, '用于');
  } else {
    const splitByColon = detailPart.match(/^(.*?)[：:]\s*(.+)$/);
    if (splitByColon) {
      detailPart = splitByColon[1].trim();
      purpose = splitByColon[2].trim();
    } else {
      detailPart = detailPart.trim();
    }
  }

  const amountMatch = detailPart.match(/([-+]?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:亿元|万元|元))/);
  const amount = amountMatch ? amountMatch[1].replace(/\s+/g, '').replace(/万\s*元/g, '万元') : '';
  if (amountMatch) {
    detailPart = detailPart.replace(amountMatch[0], ' ');
  }

  const normalizedDetail = detailPart
    .replace(/[“”"']/g, '')
    .replace(/科目/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedDetail || isIgnoredFiscalReasonLine(normalizedDetail)) return null;

  const { className, typeName, itemName } = parseFiscalReasonLevels(normalizedDetail);
  if (isIgnoredFiscalReasonLine([className, typeName, itemName].join(''))) return null;

  return {
    className,
    typeName,
    itemName,
    amount,
    purpose
  };
};

const splitFiscalReasonEntriesByNumber = (content) => {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let currentParts = [];
  let hasNumberedStarted = false;
  let lastNumber = 0;
  let stopped = false;

  lines.forEach((line) => {
    if (stopped) return;
    const cleaned = stripFiscalReasonLinePrefix(line);
    if (!cleaned) return;
    if (/^财政拨款支出主要内容如下[:：]?$/.test(cleaned)) return;

    const numbered = getFiscalReasonLineIndex(line);
    if (numbered) {
      const currentNumber = numbered.index;

      if (hasNumberedStarted && currentNumber <= lastNumber) {
        stopped = true;
        return;
      }

      if (hasNumberedStarted && currentParts.length > 0) {
        entries.push(currentParts.join(''));
      }

      hasNumberedStarted = true;
      lastNumber = currentNumber;
      currentParts = [stripFiscalReasonLinePrefix(line)];
      return;
    }

    if (!hasNumberedStarted) return;
    if (shouldStopFiscalReasonParsing(cleaned)) {
      stopped = true;
      return;
    }
    currentParts.push(line);
  });

  if (hasNumberedStarted && currentParts.length > 0) {
    entries.push(currentParts.join(''));
  }

  return entries;
};

const mergeBrokenFiscalReasonItems = (items) => {
  const merged = [];

  items.forEach((item) => {
    const prev = merged[merged.length - 1];
    const isPurposeOnlyContinuation = !String(item.className || '').trim()
      && !String(item.typeName || '').trim()
      && !String(item.itemName || '').trim()
      && !String(item.amount || '').trim()
      && Boolean(String(item.purpose || '').trim());
    const isOrphanContinuation = !String(item.className || '').trim()
      && !String(item.typeName || '').trim()
      && !String(item.amount || '').trim()
      && !String(item.purpose || '').trim()
      && Boolean(String(item.itemName || '').trim());
    const normalizedItemName = String(item.itemName || '').replace(/[（）()]/g, '').trim();
    const isAmountPurposeContinuation = !String(item.className || '').trim()
      && !String(item.typeName || '').trim()
      && Boolean(String(item.amount || '').trim())
      && Boolean(String(item.purpose || '').trim())
      && (!normalizedItemName || normalizedItemName === '主要');

    if (isPurposeOnlyContinuation && prev) {
      const continuationPurpose = String(item.purpose || '').trim();
      prev.purpose = String(prev.purpose || '').trim()
        ? appendFiscalReasonContinuation(prev.purpose, continuationPurpose)
        : continuationPurpose;
      return;
    }

    if (isAmountPurposeContinuation && prev && !String(prev.amount || '').trim()) {
      prev.amount = String(item.amount || '').trim();
      prev.purpose = String(prev.purpose || '').trim()
        ? appendFiscalReasonContinuation(prev.purpose, String(item.purpose || '').trim())
        : String(item.purpose || '').trim();
      return;
    }

    if (!isOrphanContinuation || !prev) {
      merged.push(item);
      return;
    }

    const continuation = String(item.itemName || '').trim();
    const prevPurpose = String(prev.purpose || '').trim();
    const prevItem = String(prev.itemName || '').trim();

    if (prevPurpose && !FISCAL_REASON_SENTENCE_END_REGEX.test(prevPurpose)) {
      prev.purpose = appendFiscalReasonContinuation(prevPurpose, continuation);
      return;
    }

    if (!prevPurpose && prevItem && !FISCAL_REASON_SENTENCE_END_REGEX.test(prevItem)) {
      prev.itemName = appendFiscalReasonContinuation(prevItem, continuation);
      return;
    }

    if (prevPurpose && prevPurpose.length <= 10) {
      prev.purpose = appendFiscalReasonContinuation(prevPurpose, continuation);
      return;
    }

    merged.push(item);
  });

  return merged;
};

const parseStructuredFiscalReasonItems = (content, options = {}) => {
  const refs = options.lineItemRefs || [];
  const postProcess = (items) => items
    .map((item) => inferFiscalReasonLevelsByReference(item, refs))
    .filter((item) => !isIgnoredFiscalReasonLine([item.className, item.typeName, item.itemName].join('')));

  const numberedEntries = splitFiscalReasonEntriesByNumber(content);
  if (numberedEntries.length > 0) {
    const parsed = numberedEntries
      .map((entry) => parseSingleFiscalReasonItem(entry))
      .filter(Boolean);
    return postProcess(mergeBrokenFiscalReasonItems(parsed));
  }

  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  let stopped = false;

  lines.forEach((line) => {
    if (stopped) return;

    const cleaned = stripFiscalReasonLinePrefix(line);
    if (!cleaned) return;
    if (/^财政拨款支出主要内容如下[:：]?$/.test(cleaned)) return;
    if (items.length > 0 && shouldStopFiscalReasonParsing(cleaned)) {
      stopped = true;
      return;
    }
    const parsed = parseSingleFiscalReasonItem(cleaned);
    if (!parsed) return;
    items.push(parsed);
  });

  return postProcess(mergeBrokenFiscalReasonItems(items));
};

const buildStructuredFiscalReasonLines = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .map((item) => {
      const className = String(item.className || '').trim();
      const typeName = String(item.typeName || '').trim();
      const itemName = String(item.itemName || '').trim();
      const amount = String(item.amount || '').trim();
      const purpose = String(item.purpose || '').trim();
      if (!purpose) return '';

      const detail = [
        className ? `${className}（类）` : '',
        typeName ? `${typeName}（款）` : '',
        itemName ? `${itemName}（项）` : ''
      ].filter(Boolean).join('');

      let normalizedPurpose = purpose
        .replace(/^[：:，,\s]+/, '')
        .replace(/^主要用于/, '主要用于')
        .replace(/^用于/, '主要用于');
      if (!/^主要用于|^主要原因/.test(normalizedPurpose)) {
        normalizedPurpose = `主要用于${normalizedPurpose}`;
      }

      const parts = [];
      if (detail) {
        parts.push(detail);
      } else if (itemName) {
        parts.push(itemName);
      }
      if (amount) {
        parts.push(`科目${amount}`);
      }
      parts.push(normalizedPurpose);

      return parts.join('，');
    })
    .filter(Boolean);
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

const fetchPreviousReasonsFromPdf = async ({ departmentId, unitId, year, items }) => {
  if (!departmentId || !unitId || !year || !items || items.length === 0) {
    return new Map();
  }

  const prevYear = Number(year) - 1;
  if (!Number.isInteger(prevYear) || prevYear <= 0) return new Map();

  // Prefer the structured EXPLANATION_FISCAL_DETAIL sub-section (more precise)
  const fiscalDetailResult = await db.query(
    `SELECT content_text
     FROM org_dept_text_content
     WHERE department_id = $1
       AND year = $2
       AND report_type = 'BUDGET'
       AND category = 'EXPLANATION_FISCAL_DETAIL'
       AND unit_id = $3`,
    [departmentId, prevYear, unitId]
  );

  // Fall back to the full EXPLANATION section
  const explanationResult = fiscalDetailResult.rowCount === 0
    ? await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1
         AND year = $2
         AND report_type = 'BUDGET'
         AND category = 'EXPLANATION'
         AND unit_id = $3`,
      [departmentId, prevYear, unitId]
    )
    : { rowCount: 0, rows: [] };

  // Last resort: RAW text
  const rawResult = fiscalDetailResult.rowCount === 0 && explanationResult.rowCount === 0
    ? await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1
         AND year = $2
         AND report_type = 'BUDGET'
         AND category = 'RAW'
         AND unit_id = $3`,
      [departmentId, prevYear, unitId]
    )
    : { rowCount: 0, rows: [] };

  const sourceText = fiscalDetailResult.rows[0]?.content_text
    || explanationResult.rows[0]?.content_text
    || rawResult.rows[0]?.content_text;
  if (!sourceText) return new Map();

  const prevLineItemResult = await db.query(
    `SELECT li.table_key, li.class_code, li.type_code, li.item_code, li.item_name
     FROM org_dept_line_items li
     JOIN org_dept_annual_report ar ON ar.id = li.report_id
     WHERE ar.department_id = $1
       AND ar.unit_id = $2
       AND ar.year = $3
       AND ar.report_type = 'BUDGET'
       AND li.table_key = ANY($4)
     ORDER BY li.table_key, li.row_index`,
    [departmentId, unitId, prevYear, ['general_budget', 'gov_fund_budget', 'capital_budget']]
  );

  const lineItemRefs = buildFiscalReasonLineItemReferences(prevLineItemResult.rows || []);
  const structuredItems = parseStructuredFiscalReasonItems(sourceText, { lineItemRefs });
  const structuredLines = buildStructuredFiscalReasonLines(structuredItems);
  const structuredMatched = matchReasonLinesToItems(structuredLines, items);

  const legacyLines = extractLineItemReasonLines(sourceText);
  const legacyMatched = matchReasonLinesToItems(legacyLines, items);

  if (structuredMatched.size === 0) {
    return legacyMatched;
  }

  for (const [itemKey, reasonText] of legacyMatched.entries()) {
    if (!structuredMatched.has(itemKey)) {
      structuredMatched.set(itemKey, reasonText);
    }
  }

  return structuredMatched;
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
        `SELECT li.class_code, li.type_code, li.item_code, li.item_name, li.values_json
         FROM org_dept_line_items li
         JOIN org_dept_annual_report ar ON ar.id = li.report_id
         WHERE ar.department_id = $1
           AND ar.unit_id = $2
           AND ar.year = $3
           AND ar.report_type = 'BUDGET'
           AND li.table_key = ANY($4)`,
        [departmentId, unitId, prevYear, ['general_budget', 'gov_fund_budget', 'capital_budget']]
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
      class_name: className,
      type_name: typeName,
      label: buildLineItemLabel({ itemName, className, typeName }),
      item_key: `line_item_${code}`
    };
  }).filter((item) => item.code.length >= 7);

  const dynamicFactKeys = dynamicItems.map((item) => `amount_${item.item_key}`);
  const staticCurrentKeys = LINE_ITEM_DEFINITIONS.map((item) => item.current_key);
  const staticPrevKeys = LINE_ITEM_DEFINITIONS.map((item) => item.prev_key);
  const factKeys = Array.from(new Set([
    ...dynamicFactKeys,
    ...staticCurrentKeys,
    ...staticPrevKeys
  ]));

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

  let prevHistoryMap = new Map();
  if (unitId && year && staticPrevKeys.length > 0) {
    const prevYear = Number(year) - 1;
    if (Number.isInteger(prevYear) && prevYear > 0) {
      const prevHistoryKeys = Array.from(new Set([...staticPrevKeys, ...staticCurrentKeys]));
      const prevHistoryResult = await db.query(
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
           END`,
        [unitId, prevYear, ['BUDGET', 'FINAL'], prevHistoryKeys]
      );

      prevHistoryMap = new Map();
      prevHistoryResult.rows.forEach((row) => {
        if (prevHistoryMap.has(row.key)) return;
        const parsed = Number(row.value_numeric);
        if (Number.isFinite(parsed)) {
          prevHistoryMap.set(row.key, parsed);
        }
      });
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
      unitId,
      year,
      items: dynamicItems
    });

    for (const [itemKey, reasonText] of pdfReasonMap.entries()) {
      if (!previousReasonMap.has(itemKey)) {
        previousReasonMap.set(itemKey, reasonText);
      }
    }
  }

  const staticItems = LINE_ITEM_DEFINITIONS.map((definition) => {
    const hasCurrent = factsMap.has(definition.current_key);
    const currentValue = hasCurrent ? factsMap.get(definition.current_key) : null;

    const hasPrevFromUpload = factsMap.has(definition.prev_key);
    const hasPrevFromFacts = prevFactsMap.has(definition.prev_key) || prevFactsMap.has(definition.current_key);
    const hasPrevFromHistory = prevHistoryMap.has(definition.prev_key) || prevHistoryMap.has(definition.current_key);
    const prevValue = hasPrevFromUpload
      ? factsMap.get(definition.prev_key)
      : prevFactsMap.has(definition.prev_key)
        ? prevFactsMap.get(definition.prev_key)
        : prevFactsMap.has(definition.current_key)
          ? prevFactsMap.get(definition.current_key)
          : prevHistoryMap.has(definition.prev_key)
            ? prevHistoryMap.get(definition.prev_key)
            : prevHistoryMap.has(definition.current_key)
              ? prevHistoryMap.get(definition.current_key)
              : null;

    if (!hasCurrent && !hasPrevFromUpload && !hasPrevFromFacts && !hasPrevFromHistory) {
      return null;
    }

    const currentWanyuan = toWanyuan(currentValue) ?? 0;
    const prevWanyuan = toWanyuan(prevValue);
    const reasonRequired = isReasonRequired(
      toFiniteNumber(currentValue) ?? 0,
      toFiniteNumber(prevValue),
      resolvedThreshold
    );

    const storedReason = reasonMap.get(definition.item_key);
    const previousReasonText = previousReasonMap.get(definition.item_key) || '';
    const previousReasonSnippet = extractReasonSnippet(previousReasonText);
    const storedTextRaw = storedReason?.reason_text && storedReason.reason_text.trim()
      ? storedReason.reason_text.trim()
      : null;
    const storedText = normalizeReasonTextForInput(storedTextRaw);
    const hasManualReason = Boolean(storedTextRaw);
    const initialReasonText = storedText ?? (previousReasonSnippet || '');

    return {
      item_key: definition.item_key,
      item_label: definition.label,
      amount_current_wanyuan: currentWanyuan,
      amount_prev_wanyuan: prevWanyuan,
      change_ratio: 0,
      reason_text: initialReasonText,
      previous_reason_text: previousReasonSnippet || previousReasonText,
      reason_required: reasonRequired,
      reason_is_manual: hasManualReason,
      order_no: Number.isFinite(Number(storedReason?.order_no))
        ? Number(storedReason.order_no)
        : definition.order_no
    };
  }).filter(Boolean);

  const resolvedDynamicItems = dynamicItems.map((item, index) => {
    const amountKey = `amount_${item.item_key}`;
    const currentValue = factsMap.get(amountKey) || 0;
    const currentWanyuan = toWanyuan(currentValue) ?? 0;

    const prevValue = prevFactsMap.get(amountKey) ?? prevLineItemMap.get(item.code) ?? null;
    const prevWanyuan = toWanyuan(prevValue);
    const reasonRequired = isReasonRequired(
      toFiniteNumber(currentValue) ?? 0,
      toFiniteNumber(prevValue),
      resolvedThreshold
    );

    const storedReason = reasonMap.get(item.item_key);
    const previousReasonText = previousReasonMap.get(item.item_key) || '';
    const previousReasonSnippet = extractReasonSnippet(previousReasonText);
    const storedTextRaw = storedReason?.reason_text && storedReason.reason_text.trim()
      ? storedReason.reason_text.trim()
      : null;
    const storedText = normalizeReasonTextForInput(storedTextRaw);
    const hasManualReason = Boolean(storedTextRaw);
    const initialReasonText = storedText ?? (previousReasonSnippet || '');

    return {
      item_key: item.item_key,
      item_label: item.label || `${item.name} (${item.code})`,
      amount_current_wanyuan: currentWanyuan,
      amount_prev_wanyuan: prevWanyuan,
      change_ratio: 0,
      reason_text: initialReasonText,
      previous_reason_text: previousReasonSnippet || previousReasonText,
      reason_required: reasonRequired,
      reason_is_manual: hasManualReason,
      order_no: Number.isFinite(Number(storedReason?.order_no))
        ? Number(storedReason.order_no)
        : 100 + index
    };
  });

  const items = [...staticItems, ...resolvedDynamicItems].sort((a, b) => {
    if (a.order_no !== b.order_no) {
      return a.order_no - b.order_no;
    }
    return String(a.item_key).localeCompare(String(b.item_key));
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
