const SECTION_KEYS_WITH_ORG_HEADER = new Set([
  'main_functions',
  'organizational_structure'
]);

const SECTION_KEYS_WITH_AUTO_REFLOW = new Set([
  'main_functions',
  'organizational_structure',
  'glossary'
]);

const ARCHIVE_CATEGORY_KEY_MAP = {
  FUNCTION: 'main_functions',
  STRUCTURE: 'organizational_structure',
  TERMINOLOGY: 'glossary'
};

const LEADING_ORG_HEADER_REGEX = new RegExp(
  String.raw`^[^:\uFF1A\u3002\uFF1B;]{2,120}(?:\uFF08(?:\u90e8\u95e8|\u5355\u4f4d|\u672c\u90e8)\uFF09|\((?:\u90e8\u95e8|\u5355\u4f4d|\u672c\u90e8)\))(?:\u4e3b\u8981\u804c\u80fd|\u673a\u6784\u8bbe\u7f6e)?$`
);

const ORG_NAME_LINE_HINT_REGEX = new RegExp(
  String.raw`(?:\u59d4\u5458\u4f1a|\u7ba1\u7406\u59d4\u5458\u4f1a|\u4eba\u6c11\u653f\u5e9c|\u653f\u5e9c|\u8d22\u653f\u5c40|\u53d1\u5c55\u548c\u6539\u9769\u59d4\u5458\u4f1a|\u53d1\u6539\u59d4|\u5c40|\u5385|\u529e\u4e8b\u5904|\u529e\u516c\u5ba4|\u4e2d\u5fc3|\u9662|\u9986|\u6240|\u5904|\u90e8\u95e8|\u5355\u4f4d)$`
);

const ORG_NAME_BLOCKLIST_REGEX = new RegExp(
  String.raw`(?:\u4e3b\u8981\u804c\u80fd|\u673a\u6784\u8bbe\u7f6e|\u540d\u8bcd\u89e3\u91ca|\u9884\u7b97|\u51b3\u7b97|\u60c5\u51b5\u8bf4\u660e|\u5305\u62ec|\u5982\u4e0b|\u8d2f\u5f7b|\u6267\u884c|\u7814\u7a76|\u63d0\u51fa|\u8d1f\u8d23|\u7ec4\u7ec7|\u5b9e\u65bd|\u5206\u6790|\u76d1\u7763)`
);

const ORG_HEADER_NEXT_LINE_HINT_REGEX = new RegExp(
  String.raw`^(?:\u672c\u90e8\u95e8|\u672c\u5355\u4f4d|\u8be5\u90e8\u95e8|\u8be5\u5355\u4f4d|\u4e3b\u8981\u804c\u80fd|\u673a\u6784\u8bbe\u7f6e|\u5185\u8bbe\u673a\u6784|\u4e0b\u8bbe|\u5305\u62ec|\u90e8\u95e8\u9884\u7b97|\u5355\u4f4d\u9884\u7b97)`
);

const CN_NUMERAL_TOKEN = String.raw`[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u96f6\u3007]`;
const ARABIC_TOKEN = String.raw`[\d]`;
const INDEX_TOKEN = String.raw`(?:${CN_NUMERAL_TOKEN}|${ARABIC_TOKEN}){1,4}`;
const CIRCLED_NUMBER_TOKEN = String.raw`[\u2460-\u2469]`;

const NUMBERED_LINE_REGEX = new RegExp(
  String.raw`^(?:[\uFF08(]${INDEX_TOKEN}[\uFF09)]|${INDEX_TOKEN}[、.．]\s*|\d{1,3}[.)]\s*|\u7b2c${INDEX_TOKEN}(?:\u6761|\u9879|\u6b3e|\u7ae0|\u8282)|${CIRCLED_NUMBER_TOKEN})`
);

const BULLET_LINE_REGEX = /^[-*]/;
const SENTENCE_END_PUNCT_REGEX = /[.!?;:)\]\u3002\uff01\uff1f\uff1b\uff1a\u2026\uff09\u3011\u300b\u300d\u300f"'\u201d\u2019]$/;

const normalizeTextLines = (value) => String(value || '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .split('\n')
  .map((line) => String(line || '').replace(/\u3000/g, ' ').trim())
  .filter((line) => line.length > 0);

const isLikelyOrgNameOnlyLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (text.length < 4 || text.length > 80) return false;
  if (!/[\u4e00-\u9fff]/.test(text)) return false;
  if (/[0-9]/.test(text)) return false;
  if (/[,:;.!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f]/.test(text)) return false;
  if (ORG_NAME_BLOCKLIST_REGEX.test(text)) return false;
  return ORG_NAME_LINE_HINT_REGEX.test(text);
};

const shouldDropOrgNameOnlyLine = (firstLine, secondLine) => {
  const first = String(firstLine || '').trim();
  const second = String(secondLine || '').trim();
  if (!isLikelyOrgNameOnlyLine(first) || !second) return false;
  if (second.startsWith(first) && second.length > first.length + 1) return true;
  return ORG_HEADER_NEXT_LINE_HINT_REGEX.test(second);
};

const isNumberedLine = (line) => {
  const text = String(line || '').trim();
  return NUMBERED_LINE_REGEX.test(text) || BULLET_LINE_REGEX.test(text);
};

const endsWithSentencePunct = (line) => SENTENCE_END_PUNCT_REGEX.test(String(line || '').trim());

const joinWrappedLines = (left, right) => {
  const prev = String(left || '');
  const next = String(right || '');
  if (!prev) return next;
  if (!next) return prev;
  const shouldInsertSpace = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next);
  return shouldInsertSpace ? `${prev} ${next}` : `${prev}${next}`;
};

const reflowBrokenLines = (value) => {
  const lines = normalizeTextLines(value);
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  const merged = [];
  let buffer = lines[0];

  for (let idx = 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (!endsWithSentencePunct(buffer) && !isNumberedLine(line)) {
      buffer = joinWrappedLines(buffer, line);
      continue;
    }
    merged.push(buffer);
    buffer = line;
  }

  if (buffer) {
    merged.push(buffer);
  }

  return merged.join('\n').trim();
};

const removeLeadingOrgHeaderLine = (value) => {
  const lines = normalizeTextLines(value);
  if (lines.length === 0) {
    return '';
  }

  const firstLine = lines[0];
  const secondLine = lines[1] || '';

  if (
    LEADING_ORG_HEADER_REGEX.test(firstLine)
    || shouldDropOrgNameOnlyLine(firstLine, secondLine)
  ) {
    lines.shift();
  }

  return lines.join('\n').trim();
};

const sanitizeManualTextByKey = (key, value) => {
  if (value === null || value === undefined) {
    return value;
  }

  const normalizedKey = String(key || '');
  let output = String(value);

  if (SECTION_KEYS_WITH_ORG_HEADER.has(normalizedKey)) {
    output = removeLeadingOrgHeaderLine(output);
  }

  if (SECTION_KEYS_WITH_AUTO_REFLOW.has(normalizedKey)) {
    output = reflowBrokenLines(output);
  }

  return output;
};

const sanitizeManualInputRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const nextValue = sanitizeManualTextByKey(row.key, row.value_text);
  if (nextValue === row.value_text) return row;
  return { ...row, value_text: nextValue };
};

const sanitizeArchiveTextByCategory = (category, value) => {
  const mappedKey = ARCHIVE_CATEGORY_KEY_MAP[String(category || '').toUpperCase()];
  if (!mappedKey) {
    return value;
  }
  return sanitizeManualTextByKey(mappedKey, value);
};

module.exports = {
  sanitizeManualTextByKey,
  sanitizeManualInputRow,
  sanitizeArchiveTextByCategory,
  __private: {
    removeLeadingOrgHeaderLine,
    reflowBrokenLines,
    LEADING_ORG_HEADER_REGEX,
    isLikelyOrgNameOnlyLine,
    shouldDropOrgNameOnlyLine,
    ARCHIVE_CATEGORY_KEY_MAP
  }
};
