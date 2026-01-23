const ExcelJS = require('exceljs');
const { AppError } = require('../errors');

const normalizeHeader = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim().toLowerCase();
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

const parseNumber = (rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }
  if (typeof rawValue === 'number') {
    return rawValue;
  }
  const text = String(rawValue).replace(/[,，\\s]/g, '');
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
};

const parseHistoryWorkbook = async (buffer, allowedKeys) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet('history') || workbook.worksheets[0];
  if (!sheet) {
    throw new AppError({
      statusCode: 422,
      code: 'MISSING_SHEET',
      message: 'History sheet not found'
    });
  }

  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = normalizeHeader(getPrimitiveCellValue(cell));
    if (header) {
      headers[header] = colNumber;
    }
  });

  const requiredHeaders = ['unit_code', 'year', 'key', 'value_wanyuan'];
  const missingHeaders = requiredHeaders.filter((header) => !headers[header]);
  if (missingHeaders.length > 0) {
    throw new AppError({
      statusCode: 422,
      code: 'INVALID_TEMPLATE',
      message: 'Missing required headers',
      details: { missing_headers: missingHeaders }
    });
  }

  const rows = [];
  const errors = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const unitCode = String(getPrimitiveCellValue(row.getCell(headers.unit_code)) || '').trim();
    const yearRaw = getPrimitiveCellValue(row.getCell(headers.year));
    const keyRaw = String(getPrimitiveCellValue(row.getCell(headers.key)) || '').trim();
    const valueRaw = getPrimitiveCellValue(row.getCell(headers.value_wanyuan));
    const noteCell = headers.note ? getPrimitiveCellValue(row.getCell(headers.note)) : null;
    const note = noteCell === null || noteCell === undefined ? null : String(noteCell).trim();

    if (!unitCode || !yearRaw || !keyRaw) {
      errors.push({
        row: rowNumber,
        code: 'MISSING_REQUIRED',
        message: 'Required fields are missing',
        details: {
          unit_code: unitCode || null,
          year: yearRaw || null,
          key: keyRaw || null
        }
      });
      return;
    }

    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      errors.push({
        row: rowNumber,
        code: 'INVALID_YEAR',
        message: 'Year must be a 4-digit number',
        details: { year: yearRaw }
      });
      return;
    }

    if (!allowedKeys.includes(keyRaw)) {
      errors.push({
        row: rowNumber,
        code: 'INVALID_KEY',
        message: 'Key is not allowed',
        details: { key: keyRaw }
      });
      return;
    }

    const value = parseNumber(valueRaw);
    if (value === null) {
      errors.push({
        row: rowNumber,
        code: 'INVALID_VALUE',
        message: 'Value must be numeric',
        details: { value: valueRaw }
      });
      return;
    }

    rows.push({
      unit_code: unitCode,
      year,
      key: keyRaw,
      value_wanyuan: value,
      note,
      row_number: rowNumber
    });
  });

  return {
    sheet_name: sheet.name,
    rows,
    errors
  };
};

module.exports = {
  parseHistoryWorkbook
};
