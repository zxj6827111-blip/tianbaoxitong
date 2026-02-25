const { PDFParse } = require('pdf-parse');
const db = require('../db');

const YEAR_REGEX = /(?:19|20)\d{2}/g;
const TEXT_YEAR_WITH_SUFFIX_REGEX = /((?:19|20)\d{2})\s*年/g;
const FILENAME_YEAR_WITH_SUFFIX_REGEX = /(?:^|[^A-Za-z0-9])((?:19|20)\d{2})(?=年|年度)/g;
const FILENAME_YEAR_BOUNDARY_REGEX = /(?:^|[^A-Za-z0-9])((?:19|20)\d{2})(?=[^A-Za-z0-9]|$)/g;
const BUDGET_SCOPE = {
  DEPARTMENT: 'DEPARTMENT',
  UNIT: 'UNIT'
};

const COVER_SCAN_MAX_LENGTH = 2500;
const SCOPE_DEPARTMENT_REGEX = /\u533a\u7ea7\u90e8\u95e8\u9884\u7b97|\u90e8\u95e8\u9884\u7b97/i;
const SCOPE_UNIT_REGEX = /\u533a\u7ea7\u5355\u4f4d\u9884\u7b97|\u5355\u4f4d\u9884\u7b97/i;
const UNIT_HINT_RULES = [
  {
    scope: BUDGET_SCOPE.DEPARTMENT,
    regex: /(?:\u9884\u7b97)?\u4e3b\u7ba1\u90e8\u95e8[:\uff1a\s]*([^\n\r]{2,120})/i,
    source: 'cover_department_label'
  },
  {
    scope: BUDGET_SCOPE.UNIT,
    regex: /\u9884\u7b97\u5355\u4f4d[:\uff1a\s]*([^\n\r]{2,120})/i,
    source: 'cover_unit_label'
  },
  {
    scope: null,
    regex: /\u7f16\u5236(?:\u90e8\u95e8|\u5355\u4f4d)[:\uff1a\s]*([^\n\r]{2,120})/i,
    source: 'text_label'
  },
  {
    scope: null,
    regex: /\u5355\u4f4d\u540d\u79f0[:\uff1a\s]*([^\n\r]{2,120})/i,
    source: 'text_label'
  }
];
const DEPARTMENT_LEVEL_UNIT_NAME_REGEX = /\u672c\u7ea7|\u672c\u90e8|\u673a\u5173/;
const DEPARTMENT_LEVEL_ALIAS_SUFFIX_REGEX = /(?:\u672c\u7ea7|\u672c\u90e8|\u673a\u5173)$/;

const normalizeUnitName = (value) => String(value || '')
  .trim()
  .replace(/[()\uff08\uff09\u3010\u3011\u300a\u300b\[\]\s]/g, '')
  .toLowerCase();

const sanitizeUnitGuess = (value) => String(value || '')
  .replace(/\.(pdf|PDF)$/g, '')
  .replace(/[_\-]+/g, ' ')
  .replace(/(?:19|20)\d{2}/g, ' ')
  .replace(/(?:\u5e74\u5ea6|\u9884\u7b97|\u51b3\u7b97|\u516c\u5f00|\u62a5\u544a|\u8868\u683c|\u62a5\u8868|\u9644\u4ef6|\u5e74)/g, ' ')
  .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const cleanDetectedUnitName = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .replace(/(?:\u91d1\u989d)?\u5355\u4f4d[:\uff1a\s]*\u5143*$/i, '')
  .replace(/^[\u201c\u201d"'`]+|[\u201c\u201d"'`]+$/g, '')
  .replace(/[()\uff08\uff09\u3010\u3011\u300a\u300b\[\]]+/g, '')
  .replace(/[\uff0c\u3002\uff1b;:\uff1a\s]+$/g, '')
  .trim();

const countCjkChars = (value) => (String(value || '').match(/[\u3400-\u9FFF]/g) || []).length;

const normalizeUploadedFilename = (filename) => {
  const original = String(filename || '').trim();
  if (!original) return '';

  try {
    const candidate = Buffer.from(original, 'latin1').toString('utf8');
    if (!candidate || candidate.includes('\uFFFD')) {
      return original;
    }
    if (countCjkChars(candidate) > countCjkChars(original)) {
      return candidate;
    }
  } catch {
    return original;
  }

  return original;
};

const toValidYear = (value) => {
  const year = Number(value);
  if (!Number.isInteger(year)) return null;
  if (year < 1900 || year > 2100) return null;
  return year;
};

const firstYearByRegex = (text, regex) => {
  const source = String(text || '');
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  let matched = matcher.exec(source);
  while (matched) {
    const token = matched[1] || matched[0];
    const year = toValidYear(token);
    if (year) return year;
    matched = matcher.exec(source);
  }
  return null;
};

const pickYearFromText = (text) => {
  const coverText = getCoverText(text);
  return (
    firstYearByRegex(coverText, TEXT_YEAR_WITH_SUFFIX_REGEX)
    || firstYearByRegex(coverText, YEAR_REGEX)
  );
};

const pickYearFromFilename = (filename) => {
  const name = String(filename || '').replace(/\.[^.]+$/, '');
  return (
    firstYearByRegex(name, FILENAME_YEAR_WITH_SUFFIX_REGEX)
    || firstYearByRegex(name, FILENAME_YEAR_BOUNDARY_REGEX)
  );
};

const getCoverText = (text) => String(text || '').slice(0, COVER_SCAN_MAX_LENGTH);

const detectBudgetScope = (filename, text) => {
  const coverText = getCoverText(text);
  const filenameText = String(filename || '');
  const deptInText = coverText.search(SCOPE_DEPARTMENT_REGEX);
  const unitInText = coverText.search(SCOPE_UNIT_REGEX);

  if (deptInText >= 0 && unitInText < 0) return BUDGET_SCOPE.DEPARTMENT;
  if (unitInText >= 0 && deptInText < 0) return BUDGET_SCOPE.UNIT;
  if (deptInText >= 0 && unitInText >= 0) {
    return deptInText <= unitInText ? BUDGET_SCOPE.DEPARTMENT : BUDGET_SCOPE.UNIT;
  }

  if (SCOPE_DEPARTMENT_REGEX.test(filenameText) && !SCOPE_UNIT_REGEX.test(filenameText)) {
    return BUDGET_SCOPE.DEPARTMENT;
  }
  if (SCOPE_UNIT_REGEX.test(filenameText) && !SCOPE_DEPARTMENT_REGEX.test(filenameText)) {
    return BUDGET_SCOPE.UNIT;
  }
  return null;
};

const extractNamedEntityFromText = (text, scope) => {
  const bodyText = String(text || '');
  const prioritizedRules = [
    ...UNIT_HINT_RULES.filter((rule) => rule.scope === scope),
    ...UNIT_HINT_RULES.filter((rule) => !rule.scope),
    ...UNIT_HINT_RULES.filter((rule) => rule.scope && rule.scope !== scope)
  ];

  for (const rule of prioritizedRules) {
    const matched = bodyText.match(rule.regex);
    const candidate = matched?.[1] ? cleanDetectedUnitName(matched[1]) : '';
    if (!candidate) continue;
    return {
      name: candidate,
      source: rule.source
    };
  }
  return null;
};

const pickDepartmentLevelUnit = (units, normalizedTarget) => {
  const list = Array.isArray(units) ? units : [];
  if (list.length === 0) return null;
  const exactName = list.find((unit) => normalizeUnitName(unit.name) === normalizedTarget);
  if (exactName) return exactName;
  const departmentNameMatch = list.find((unit) => normalizeUnitName(unit.department_name) === normalizedTarget);
  if (departmentNameMatch) return departmentNameMatch;
  const nativeDept = list.find((unit) => DEPARTMENT_LEVEL_UNIT_NAME_REGEX.test(String(unit.name || '')));
  if (nativeDept) return nativeDept;
  return list[0];
};

const buildMatchCandidate = ({ unit, normalizedTarget, scopeHint, index }) => {
  const normalizedUnitName = normalizeUnitName(unit.name);
  const normalizedDeptName = normalizeUnitName(unit.department_name);
  let score = 0;
  let matchType = 'none';

  if (normalizedUnitName === normalizedTarget) {
    score = 100;
    matchType = 'exact';
  } else if (normalizedDeptName && normalizedDeptName === normalizedTarget) {
    score = 95;
    matchType = 'exact';
  } else if (normalizedUnitName.includes(normalizedTarget)) {
    score = 60 + Math.min(20, normalizedTarget.length);
    matchType = 'fuzzy';
  } else if (normalizedTarget.includes(normalizedUnitName)) {
    score = 55 + Math.min(20, normalizedUnitName.length);
    matchType = 'fuzzy';
  } else if (normalizedDeptName && normalizedDeptName.includes(normalizedTarget)) {
    score = 54 + Math.min(18, normalizedTarget.length);
    matchType = 'fuzzy';
  } else if (normalizedDeptName && normalizedTarget.includes(normalizedDeptName)) {
    score = 52 + Math.min(18, normalizedDeptName.length);
    matchType = 'fuzzy';
  } else {
    return null;
  }

  if (scopeHint === BUDGET_SCOPE.DEPARTMENT) {
    if (normalizedDeptName === normalizedTarget) score += 16;
    if (DEPARTMENT_LEVEL_UNIT_NAME_REGEX.test(String(unit.name || ''))) score += 10;
    if (normalizedUnitName === normalizedDeptName) score += 8;
  } else if (scopeHint === BUDGET_SCOPE.UNIT) {
    if (normalizedUnitName === normalizedTarget) score += 8;
    if (DEPARTMENT_LEVEL_UNIT_NAME_REGEX.test(String(unit.name || '')) && matchType !== 'exact') score -= 6;
  }

  return {
    unit,
    score,
    matchType,
    lengthDiff: Math.abs(normalizedUnitName.length - normalizedTarget.length),
    index
  };
};

const scoreToConfidence = (score) => {
  if (score >= 110) return 1;
  if (score >= 95) return 0.92;
  if (score >= 80) return 0.78;
  if (score >= 65) return 0.66;
  return 0.55;
};

const extractPdfText = async (buffer) => {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result?.text || '').trim();
  } finally {
    await parser.destroy();
  }
};

const identifyUnitAndYear = (filename, text) => {
  const filenameText = String(filename || '');
  const bodyText = String(text || '');
  const scope = detectBudgetScope(filenameText, bodyText);
  const yearFromText = pickYearFromText(bodyText);
  const yearFromFilename = pickYearFromFilename(filenameText);
  const year = yearFromText || yearFromFilename || null;

  let unitName = null;
  let unitSource = null;
  const extracted = extractNamedEntityFromText(bodyText, scope);

  if (extracted) {
    unitName = extracted.name;
    unitSource = extracted.source;
  }

  if (!unitName) {
    const fallback = sanitizeUnitGuess(filenameText);
    if (fallback) {
      unitName = fallback;
      unitSource = 'filename';
    }
  }

  return {
    unitName: unitName || null,
    year,
    scope,
    unitSource,
    yearSource: year ? (yearFromText ? 'text' : 'filename') : null
  };
};

const matchExistingUnit = (unitName, unitCatalog, options = {}) => {
  if (!unitName || !Array.isArray(unitCatalog) || unitCatalog.length === 0) {
    return null;
  }

  const normalizedTarget = normalizeUnitName(unitName);
  if (!normalizedTarget) {
    return null;
  }

  const scopeHint = options.scope || null;

  if (scopeHint === BUDGET_SCOPE.UNIT) {
    const normalizedWithoutAlias = normalizedTarget.replace(DEPARTMENT_LEVEL_ALIAS_SUFFIX_REGEX, '');
    if (normalizedWithoutAlias !== normalizedTarget) {
      const departmentMatch = unitCatalog.find((unit) => normalizeUnitName(unit.department_name) === normalizedWithoutAlias);
      if (departmentMatch) {
        const candidates = unitCatalog.filter(
          (unit) => String(unit.department_id || '') === String(departmentMatch.department_id || '')
        );
        const picked = pickDepartmentLevelUnit(candidates, normalizedWithoutAlias);
        if (picked) {
          return {
            unit: picked,
            match_type: 'exact',
            confidence: 0.96
          };
        }
      }
    }
  }

  if (scopeHint === BUDGET_SCOPE.DEPARTMENT) {
    const unitsByDepartment = new Map();
    unitCatalog.forEach((unit) => {
      const departmentId = String(unit.department_id || '');
      if (!departmentId) return;
      const list = unitsByDepartment.get(departmentId) || [];
      list.push(unit);
      unitsByDepartment.set(departmentId, list);
    });

    const departmentMatch = unitCatalog.find((unit) => normalizeUnitName(unit.department_name) === normalizedTarget);
    if (departmentMatch) {
      const candidates = unitsByDepartment.get(String(departmentMatch.department_id || '')) || [];
      const picked = pickDepartmentLevelUnit(candidates, normalizedTarget);
      if (picked) {
        return {
          unit: picked,
          match_type: 'exact',
          confidence: 0.98
        };
      }
    }
  }

  const candidates = unitCatalog
    .map((unit, index) => buildMatchCandidate({ unit, normalizedTarget, scopeHint, index }))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.lengthDiff !== right.lengthDiff) return left.lengthDiff - right.lengthDiff;
      return left.index - right.index;
    });

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates[0];
  if (!best || best.score < 55) {
    return null;
  }

  if (best.matchType === 'exact') {
    return {
      unit: best.unit,
      match_type: 'exact',
      confidence: scoreToConfidence(best.score)
    };
  }

  return {
    unit: best.unit,
    match_type: 'fuzzy',
    confidence: scoreToConfidence(best.score)
  };
};

const loadUnitCatalog = async () => {
  const result = await db.query(
    `SELECT u.id,
            u.name,
            u.code,
            u.department_id,
            d.name AS department_name
     FROM org_unit u
     LEFT JOIN org_department d ON d.id = u.department_id
     ORDER BY d.sort_order ASC, d.name ASC, u.sort_order ASC, u.name ASC`
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    code: row.code,
    department_id: row.department_id ? String(row.department_id) : null,
    department_name: row.department_name || null
  }));
};

module.exports = {
  extractPdfText,
  identifyUnitAndYear,
  matchExistingUnit,
  loadUnitCatalog,
  normalizeUploadedFilename,
  __private: {
    detectBudgetScope,
    extractNamedEntityFromText,
    normalizeUnitName,
    cleanDetectedUnitName,
    BUDGET_SCOPE
  }
};
