const ExcelJS = require('exceljs');
const { AppError } = require('../errors');
const { BUDGET_MAPPING } = require('./budgetMapping');

const normalizeCellText = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

const getPrimitiveCellValue = (cell) => {
  const value = cell.value;
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return value.result;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'richText')) {
      return value.richText.map((item) => item.text).join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return value.text;
    }
  }
  return value;
};

const detectUnitMultiplier = (text, numberFormat) => {
  const unitText = `${text || ''}${numberFormat || ''}`;
  if (unitText.includes('万元')) {
    return 10000;
  }
  if (unitText.includes('千元')) {
    return 1000;
  }
  if (unitText.includes('元')) {
    return 1;
  }
  return 1;
};

const normalizeNumber = (rawValue, numberFormat) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }

  if (typeof rawValue === 'number') {
    const multiplier = detectUnitMultiplier('', numberFormat);
    return rawValue * multiplier;
  }

  let text = normalizeCellText(rawValue);
  if (!text) {
    return null;
  }

  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }

  const multiplier = detectUnitMultiplier(text, numberFormat);

  const isPercent = text.includes('%');
  text = text.replace(/[%\s]/g, '');
  text = text.replace(/[,，]/g, '');
  text = text.replace(/万元|千元|元/g, '');

  const parsed = Number(text);
  if (Number.isNaN(parsed)) {
    return null;
  }

  let result = parsed * multiplier;
  if (isPercent) {
    result = result / 100;
  }
  if (negative) {
    result = -result;
  }
  return result;
};

const getValueType = (value) => {
  if (value === null || value === undefined) {
    return 'empty';
  }
  if (value instanceof Date) {
    return 'date';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'object' && value.formula) {
    return 'formula';
  }
  return 'string';
};

const findCellByText = (sheet, targetText) => {
  const normalizedTarget = normalizeCellText(targetText);
  let foundCell = null;

  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (foundCell) {
        return;
      }
      const cellValue = normalizeCellText(getPrimitiveCellValue(cell));
      if (cellValue === normalizedTarget) {
        foundCell = cell;
      }
    });
  });

  return foundCell;
};

const collectParsedCell = (collection, sheetName, cell, anchor) => {
  const cellKey = `${sheetName}::${cell.address}`;
  if (collection.has(cellKey)) {
    return collection.get(cellKey);
  }

  const primitiveValue = getPrimitiveCellValue(cell);
  const rawValue = primitiveValue === null || primitiveValue === undefined ? null : String(primitiveValue);
  const normalizedValue = normalizeCellText(primitiveValue);
  const entry = {
    sheet_name: sheetName,
    cell_address: cell.address,
    anchor,
    raw_value: rawValue,
    normalized_value: normalizedValue,
    value_type: getValueType(primitiveValue),
    number_format: cell.numFmt || null
  };

  collection.set(cellKey, entry);
  return entry;
};

const parseBudgetWorkbook = async (filePath, mapping = BUDGET_MAPPING) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const parsedCellsMap = new Map();
  const facts = [];

  for (const rule of mapping) {
    const sheet = workbook.getWorksheet(rule.sheet);
    if (!sheet) {
      throw new AppError({
        statusCode: 422,
        code: 'MISSING_SHEET',
        message: `Required sheet missing: ${rule.sheet}`,
        details: {
          rule: rule.key,
          evidence: {
            sheet_name: rule.sheet
          }
        }
      });
    }

    const rowAnchorCell = findCellByText(sheet, rule.rowAnchor);
    const colAnchorCell = findCellByText(sheet, rule.colAnchor);

    if (!rowAnchorCell || !colAnchorCell) {
      throw new AppError({
        statusCode: 422,
        code: 'MISSING_ANCHOR',
        message: `Anchor cell missing for ${rule.key}`,
        details: {
          rule: rule.key,
          evidence: {
            sheet_name: rule.sheet,
            row_anchor: rule.rowAnchor,
            col_anchor: rule.colAnchor
          }
        }
      });
    }

    const targetCell = sheet.getCell(rowAnchorCell.row, colAnchorCell.col);
    const anchorText = `row:${rule.rowAnchor}|col:${rule.colAnchor}`;

    const targetEntry = collectParsedCell(parsedCellsMap, sheet.name, targetCell, anchorText);
    const rowAnchorEntry = collectParsedCell(parsedCellsMap, sheet.name, rowAnchorCell, `row_anchor:${rule.rowAnchor}`);
    const colAnchorEntry = collectParsedCell(parsedCellsMap, sheet.name, colAnchorCell, `col_anchor:${rule.colAnchor}`);

    const normalizedNumber = normalizeNumber(getPrimitiveCellValue(targetCell), targetCell.numFmt || '');

    if (normalizedNumber === null) {
      throw new AppError({
        statusCode: 422,
        code: 'MISSING_VALUE',
        message: `Required cell is empty for ${rule.key}`,
        details: {
          rule: rule.key,
          evidence: {
            sheet_name: sheet.name,
            cell_address: targetCell.address
          }
        }
      });
    }

    facts.push({
      key: rule.key,
      value_numeric: normalizedNumber,
      evidence_cells: [targetEntry, rowAnchorEntry, colAnchorEntry]
    });
  }

  return {
    parsedCells: Array.from(parsedCellsMap.values()),
    facts
  };
};

module.exports = {
  parseBudgetWorkbook,
  normalizeNumber
};
