const SECTION_KEYS_WITH_ORG_HEADER = new Set([
  'main_functions',
  'organizational_structure'
]);

const ARCHIVE_CATEGORY_KEY_MAP = {
  FUNCTION: 'main_functions',
  STRUCTURE: 'organizational_structure'
};

const LEADING_ORG_HEADER_REGEX = new RegExp(
  String.raw`^[^:\uFF1A\u3002\uFF1B;]{2,120}(?:\uFF08(?:\u90e8\u95e8|\u5355\u4f4d|\u672c\u90e8)\uFF09|\((?:\u90e8\u95e8|\u5355\u4f4d|\u672c\u90e8)\))(?:\u4e3b\u8981\u804c\u80fd|\u673a\u6784\u8bbe\u7f6e)?$`
);

const removeLeadingOrgHeaderLine = (value) => {
  const lines = String(value).split(/\r?\n/);
  let firstContentIndex = 0;

  while (firstContentIndex < lines.length && lines[firstContentIndex].trim() === '') {
    firstContentIndex += 1;
  }

  if (firstContentIndex >= lines.length) {
    return '';
  }

  if (LEADING_ORG_HEADER_REGEX.test(lines[firstContentIndex].trim())) {
    lines.splice(0, firstContentIndex + 1);
  }

  return lines.join('\n').trim();
};

const sanitizeManualTextByKey = (key, value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (!SECTION_KEYS_WITH_ORG_HEADER.has(String(key || ''))) {
    return String(value);
  }

  return removeLeadingOrgHeaderLine(value);
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
    LEADING_ORG_HEADER_REGEX,
    ARCHIVE_CATEGORY_KEY_MAP
  }
};
