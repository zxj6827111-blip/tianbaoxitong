const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const path = require('path');
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

const findCellByText = (sheet, targetText, occurrence = 1) => {
  const normalizedTarget = normalizeCellText(targetText);
  let foundCell = null;
  let matchCount = 0;

  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (foundCell && occurrence !== -1) {
        return;
      }
      const cellValue = normalizeCellText(getPrimitiveCellValue(cell));
      if (cellValue === normalizedTarget) {
        matchCount += 1;
        if (occurrence === -1 || matchCount === occurrence) {
          foundCell = cell;
        }
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

const extractAllContent = (sheet) => {
  const fullText = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1 && sheet.rowCount > 1) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const val = normalizeCellText(getPrimitiveCellValue(cell));
      if (val) fullText.push(val);
    });
  });
  return fullText.join('\n');
};

const extractFirstCell = (sheet) => {
  let first = '';
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (first) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (first) return;
      const val = normalizeCellText(getPrimitiveCellValue(cell));
      if (val) first = val;
    });
  });
  return first;
};

const sumFromCols = ({ sheet, row, colHeaders, parsedCellsMap, sheetName }) => {
  let sum = 0;
  const evidenceCells = [];

  for (const header of colHeaders) {
    const colAnchor = findCellByText(sheet, header);
    if (!colAnchor) continue;
    const targetCell = sheet.getCell(row, colAnchor.col);
    const val = normalizeNumber(getPrimitiveCellValue(targetCell), targetCell.numFmt || '');
    if (val !== null && val !== undefined) {
      sum += val;
    }
    evidenceCells.push(collectParsedCell(parsedCellsMap, sheetName, targetCell, `sum_col:${header}`));
  }

  return { sum, evidenceCells };
};

const sumFromRows = ({ sheet, col, rowHeaders, parsedCellsMap, sheetName }) => {
  let sum = 0;
  const evidenceCells = [];

  for (const header of rowHeaders) {
    const rowAnchor = findCellByText(sheet, header);
    if (!rowAnchor) continue;
    const targetCell = sheet.getCell(rowAnchor.row, col);
    const val = normalizeNumber(getPrimitiveCellValue(targetCell), targetCell.numFmt || '');
    if (val !== null && val !== undefined) {
      sum += val;
    }
    evidenceCells.push(collectParsedCell(parsedCellsMap, sheetName, targetCell, `sum_row:${header}`));
  }

  return { sum, evidenceCells };
};

// --- SheetJS Helper Functions ---

const findSheetJSCellByText = (worksheet, targetText, occurrence = 1) => {
  const normalizedTarget = normalizeCellText(targetText);
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  let matchCount = 0;
  let lastMatch = null;

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[cellAddr];
      if (!cell) continue;

      const cellValue = normalizeCellText(cell.v);
      if (cellValue === normalizedTarget) {
        matchCount += 1;
        const payload = {
          row: R + 1,
          col: C + 1,
          address: cellAddr,
          value: cell.v,
          numFmt: cell.z
        };
        if (occurrence === -1) {
          lastMatch = payload;
          continue;
        }
        if (matchCount === occurrence) {
          return payload;
        }
      }
    }
  }
  return lastMatch;
};

const extractSheetJSText = (worksheet, strategy) => {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  if (strategy === 'first_cell') {
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = worksheet[cellAddr];
        if (!cell) continue;
        const cellValue = normalizeCellText(cell.v);
        if (cellValue) return cellValue;
      }
    }
    return '';
  }

  const lines = [];
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[cellAddr];
      if (!cell) continue;
      const cellValue = normalizeCellText(cell.v);
      if (cellValue) lines.push(cellValue);
    }
  }
  return lines.join('\n');
};

const parseWithSheetJS = (filePath, mapping) => {
  console.log('[ExcelParser] Falling back to SheetJS (xlsx) parser...');
  const workbook = XLSX.readFile(filePath);
  const parsedCellsMap = new Map();
  const facts = [];
  const texts = [];
  const resolvedKeys = new Set();

  for (const rule of mapping) {
    // Skip if this key was already resolved by a previous rule variant
    if (resolvedKeys.has(rule.key) && rule.type !== 'text') {
      continue;
    }

    let sheet = workbook.Sheets[rule.sheet];
    let sheetName = rule.sheet;
    if (!sheet && rule.aliases) {
      for (const alias of rule.aliases) {
        if (workbook.Sheets[alias]) {
          sheet = workbook.Sheets[alias];
          sheetName = alias;
          break;
        }
      }
    }
    if (!sheet) {
      if (rule.type === 'text' || rule.optional) continue;
      const availableSheets = Object.keys(workbook.Sheets);
      throw new AppError({
        statusCode: 422,
        code: 'MISSING_SHEET',
        message: `找不到必须的工作表: "${rule.sheet}"${rule.aliases ? ' (或其别名)' : ''}。\n\n您的Excel文件中包含的工作表: ${availableSheets.join(', ')}`,
        details: {
          rule: rule.key,
          evidence: {
            sheet_name: rule.sheet,
            available_sheets: availableSheets
          }
        }
      });
    }

    if (rule.type === 'text') {
      const textValue = extractSheetJSText(sheet, rule.strategy || 'all_content');
      if (textValue) {
        texts.push({ key: rule.key, value_text: textValue });
      }
      continue;
    }

    let rowAnchorCell = findSheetJSCellByText(sheet, rule.rowAnchor, rule.rowAnchorIndex);
    if (!rowAnchorCell && rule.rowAnchorAliases) {
      for (const alias of rule.rowAnchorAliases) {
        rowAnchorCell = findSheetJSCellByText(sheet, alias, rule.rowAnchorIndex);
        if (rowAnchorCell) break;
      }
    }

    let colAnchorCell = findSheetJSCellByText(sheet, rule.colAnchor, rule.colAnchorIndex);
    if (!colAnchorCell && rule.colAnchorAliases) {
      for (const alias of rule.colAnchorAliases) {
        colAnchorCell = findSheetJSCellByText(sheet, alias, rule.colAnchorIndex);
        if (colAnchorCell) break;
      }
    }

    if (!rowAnchorCell || !colAnchorCell) {
      if (rule.optional) {
        continue;
      }
      throw new AppError({
        statusCode: 422,
        code: 'MISSING_ANCHOR',
        message: `Sheet "${sheetName}" formatting incorrect. Could not find anchor: Row="${rule.rowAnchor}" (or aliases), Col="${rule.colAnchor}" (or aliases)`,
        details: {
          rule: rule.key,
          evidence: {
            sheet_name: sheetName,
            row_anchor: rule.rowAnchor,
            col_anchor: rule.colAnchor
          }
        }
      });
    }

    const targetRow = rowAnchorCell.row - 1 + (rule.rowOffset || 0);
    const targetCol = colAnchorCell.col - 1 + (rule.colOffset || 0);
    const targetAddr = XLSX.utils.encode_cell({ r: targetRow, c: targetCol });
    const rawTargetCell = sheet[targetAddr];

    const targetCell = {
      address: targetAddr,
      value: rawTargetCell ? rawTargetCell.v : null,
      numFmt: rawTargetCell ? rawTargetCell.z : null
    };

    const rowAnchorAdapt = {
      address: rowAnchorCell.address,
      value: rowAnchorCell.value,
      numFmt: rowAnchorCell.numFmt
    };

    const colAnchorAdapt = {
      address: colAnchorCell.address,
      value: colAnchorCell.value,
      numFmt: colAnchorCell.numFmt
    };

    const anchorText = `row:${rule.rowAnchor}|col:${rule.colAnchor}`;
    const targetEntry = collectParsedCell(parsedCellsMap, sheetName, targetCell, anchorText);
    const rowAnchorEntry = collectParsedCell(parsedCellsMap, sheetName, rowAnchorAdapt, `row_anchor:${rule.rowAnchor}`);
    const colAnchorEntry = collectParsedCell(parsedCellsMap, sheetName, colAnchorAdapt, `col_anchor:${rule.colAnchor}`);

    let normalizedNumber = normalizeNumber(targetCell.value, targetCell.numFmt || '');
    const extraEvidence = [];

    if ((normalizedNumber === null || normalizedNumber === 0) && Array.isArray(rule.sumCols)) {
      let sum = 0;
      for (const header of rule.sumCols) {
        const colAnchor = findSheetJSCellByText(sheet, header);
        if (!colAnchor) continue;
        const addr = XLSX.utils.encode_cell({ r: targetRow, c: colAnchor.col - 1 });
        const cell = sheet[addr];
        const cellValue = normalizeNumber(cell ? cell.v : null, cell ? cell.z : '');
        if (cellValue !== null && cellValue !== undefined) sum += cellValue;
        extraEvidence.push(collectParsedCell(parsedCellsMap, sheetName, {
          address: addr,
          value: cell ? cell.v : null,
          numFmt: cell ? cell.z : null
        }, `sum_col:${header}`));
      }
      normalizedNumber = sum;
    }

    if ((normalizedNumber === null || normalizedNumber === 0) && Array.isArray(rule.sumRows)) {
      let sum = 0;
      for (const header of rule.sumRows) {
        const rowAnchor = findSheetJSCellByText(sheet, header);
        if (!rowAnchor) continue;
        const addr = XLSX.utils.encode_cell({ r: rowAnchor.row - 1, c: colAnchorCell.col - 1 });
        const cell = sheet[addr];
        const cellValue = normalizeNumber(cell ? cell.v : null, cell ? cell.z : '');
        if (cellValue !== null && cellValue !== undefined) sum += cellValue;
        extraEvidence.push(collectParsedCell(parsedCellsMap, sheetName, {
          address: addr,
          value: cell ? cell.v : null,
          numFmt: cell ? cell.z : null
        }, `sum_row:${header}`));
      }
      normalizedNumber = sum;
    }

    if (normalizedNumber === null) {
      if (rule.optional) {
        continue;
      }
      throw new AppError({
        statusCode: 422,
        code: 'MISSING_VALUE',
        message: `Required cell is empty for ${rule.key}`,
        details: {
          rule: rule.key,
          evidence: {
            sheet_name: sheetName,
            cell_address: targetAddr
          }
        }
      });
    }

    facts.push({
      key: rule.key,
      value_numeric: normalizedNumber,
      evidence_cells: [targetEntry, rowAnchorEntry, colAnchorEntry, ...extraEvidence]
    });
    resolvedKeys.add(rule.key);
  }

  const lineItemResult = parseLineItemsSheetJS(workbook);
  facts.push(...lineItemResult.facts);
  texts.push(...lineItemResult.texts);

  return {
    parsedCells: Array.from(parsedCellsMap.values()),
    facts,
    texts
  };
};

// === Helper: Parse Line Items from 2.20 ===
const LINE_ITEM_SHEETS = [
  '3.21部门一般公共预算支出功能分类预算表',
  '2.20单位一般公共预算拨款表'
];

const pickLineItemSheetJS = (workbook) => {
  for (const name of LINE_ITEM_SHEETS) {
    const sheet = workbook.Sheets[name];
    if (sheet && sheet['!ref']) {
      return { sheet, sheetName: name };
    }
  }
  return { sheet: null, sheetName: '' };
};

const pickLineItemSheet = (workbook) => {
  for (const name of LINE_ITEM_SHEETS) {
    const sheet = workbook.getWorksheet(name);
    if (sheet) {
      return { sheet, sheetName: name };
    }
  }
  return { sheet: null, sheetName: '' };
};

const parseLineItemsSheetJS = (workbook) => {
  const { sheet } = pickLineItemSheetJS(workbook);
  if (!sheet) return { facts: [], texts: [] };

  const facts = [];
  const texts = [];
  const classNames = new Map();
  const typeNames = new Map();

  const range = XLSX.utils.decode_range(sheet['!ref']);
  let headerRow = -1;

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[addr];
      if (!cell) continue;
      const val = normalizeCellText(cell.v);
      if (val && val.includes('功能分类科目编码')) {
        headerRow = R;
        break;
      }
    }
    if (headerRow !== -1) break;
  }

  if (headerRow === -1) headerRow = 6;

  const colMap = {
    classCode: 0,
    typeCode: 1,
    itemCode: 2,
    name: 3,
    total: 4,
    basic: 5,
    project: 6
  };

  for (let C = range.s.c; C <= range.e.c; ++C) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c: C });
    const cell = sheet[addr];
    if (!cell) continue;
    const val = normalizeCellText(cell.v);
    if (val === '类') colMap.classCode = C;
    if (val === '款') colMap.typeCode = C;
    if (val === '项') colMap.itemCode = C;
    if (val.includes('功能分类科目名称') || val.includes('科目名称')) colMap.name = C;
    if (val === '合计') colMap.total = C;
    if (val.includes('基本支出')) colMap.basic = C;
    if (val.includes('项目支出')) colMap.project = C;
  }

  for (let R = headerRow + 1; R <= range.e.r; ++R) {
    const classCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.classCode })];
    const typeCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.typeCode })];
    const itemCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.itemCode })];
    const nameCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.name })];

    const classCode = normalizeCellText(classCell ? classCell.v : '');
    const typeCode = normalizeCellText(typeCell ? typeCell.v : '');
    const itemCode = normalizeCellText(itemCell ? itemCell.v : '');
    const name = normalizeCellText(nameCell ? nameCell.v : '');

    if (!classCode) continue;

    if (classCode && !typeCode && !itemCode) {
      if (name && !classNames.has(classCode)) classNames.set(classCode, name);
      continue;
    }

    if (classCode && typeCode && !itemCode) {
      const typeKey = `${classCode}${typeCode}`;
      if (name && !typeNames.has(typeKey)) typeNames.set(typeKey, name);
      continue;
    }

    if (!itemCode) continue;

    const code = [classCode, typeCode, itemCode].filter(Boolean).join('');
    if (!code || !/^\d+$/.test(code)) continue;

    const totalCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.total })];
    const basicCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.basic })];
    const projectCell = sheet[XLSX.utils.encode_cell({ r: R, c: colMap.project })];

    let amount = normalizeNumber(totalCell ? totalCell.v : null, totalCell ? totalCell.z : '');
    if (!amount) {
      const basic = normalizeNumber(basicCell ? basicCell.v : null, basicCell ? basicCell.z : '') || 0;
      const project = normalizeNumber(projectCell ? projectCell.v : null, projectCell ? projectCell.z : '') || 0;
      amount = basic + project;
    }

    if (!amount) continue;

    const itemKey = `line_item_${code}`;
    facts.push({ key: `amount_${itemKey}`, value_numeric: amount, evidence_cells: [] });
    texts.push({ key: `name_${itemKey}`, value_text: name });
    texts.push({ key: `code_${itemKey}`, value_text: code });
  }

  for (const [code, name] of classNames.entries()) {
    texts.push({ key: `name_class_${code}`, value_text: name });
  }
  for (const [code, name] of typeNames.entries()) {
    texts.push({ key: `name_type_${code}`, value_text: name });
  }

  return { facts, texts };
};

const parseLineItems = (workbook) => {
  const { sheet } = pickLineItemSheet(workbook);
  if (!sheet) return { facts: [], texts: [] };

  const facts = [];
  const texts = [];
  const classNames = new Map();
  const typeNames = new Map();

  let headerRowIndex = -1;
  sheet.eachRow((row, rowNumber) => {
    if (headerRowIndex !== -1) return;
    row.eachCell((cell) => {
      const val = normalizeCellText(getPrimitiveCellValue(cell));
      if (val && val.includes('功能分类科目编码')) {
        headerRowIndex = rowNumber;
      }
    });
  });

  if (headerRowIndex === -1) {
    headerRowIndex = 7;
  }

  const headerRow = sheet.getRow(headerRowIndex);
  let colMap = {
    classCode: 1,
    typeCode: 2,
    itemCode: 3,
    name: 4,
    total: 5,
    basic: 6,
    project: 7
  };

  headerRow.eachCell((cell, colNumber) => {
    const val = normalizeCellText(getPrimitiveCellValue(cell));
    if (val === '类') colMap.classCode = colNumber;
    if (val === '款') colMap.typeCode = colNumber;
    if (val === '项') colMap.itemCode = colNumber;
    if (val.includes('功能分类科目名称') || val.includes('科目名称')) colMap.name = colNumber;
    if (val === '合计') colMap.total = colNumber;
    if (val.includes('基本支出')) colMap.basic = colNumber;
    if (val.includes('项目支出')) colMap.project = colNumber;
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;

    const classCode = normalizeCellText(getPrimitiveCellValue(row.getCell(colMap.classCode)));
    const typeCode = normalizeCellText(getPrimitiveCellValue(row.getCell(colMap.typeCode)));
    const itemCode = normalizeCellText(getPrimitiveCellValue(row.getCell(colMap.itemCode)));
    const name = normalizeCellText(getPrimitiveCellValue(row.getCell(colMap.name)));

    if (!classCode) return;

    if (classCode && !typeCode && !itemCode) {
      if (name && !classNames.has(classCode)) classNames.set(classCode, name);
      return;
    }

    if (classCode && typeCode && !itemCode) {
      const typeKey = `${classCode}${typeCode}`;
      if (name && !typeNames.has(typeKey)) typeNames.set(typeKey, name);
      return;
    }

    if (!itemCode) return;

    const code = [classCode, typeCode, itemCode].filter(Boolean).join('');
    if (!code || !/^\d+$/.test(code)) return;

    const totalVal = getPrimitiveCellValue(row.getCell(colMap.total));
    const basicVal = getPrimitiveCellValue(row.getCell(colMap.basic));
    const projectVal = getPrimitiveCellValue(row.getCell(colMap.project));

    let amount = normalizeNumber(totalVal);
    if (!amount) {
      const basic = normalizeNumber(basicVal) || 0;
      const project = normalizeNumber(projectVal) || 0;
      amount = basic + project;
    }

    if (!amount) return;

    const itemKey = `line_item_${code}`;

    facts.push({
      key: `amount_${itemKey}`,
      value_numeric: amount,
      evidence_cells: []
    });

    texts.push({
      key: `name_${itemKey}`,
      value_text: name
    });

    texts.push({
      key: `code_${itemKey}`,
      value_text: code
    });
  });

  for (const [code, name] of classNames.entries()) {
    texts.push({ key: `name_class_${code}`, value_text: name });
  }
  for (const [code, name] of typeNames.entries()) {
    texts.push({ key: `name_type_${code}`, value_text: name });
  }

  return { facts, texts };
};

// --- Main Parser Function ---

const parseBudgetWorkbook = async (filePath, mapping = BUDGET_MAPPING) => {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.xls') {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_FILE_TYPE',
      message: 'Legacy .xls files are not supported. Please upload .xlsx files.'
    });
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);

    const parsedCellsMap = new Map();
    const facts = [];
    const texts = [];
    const resolvedKeys = new Set();

    for (const rule of mapping) {
      // Skip if this key was already resolved by a previous rule variant
      if (resolvedKeys.has(rule.key) && rule.type !== 'text') {
        continue;
      }

      // 1. Resolve Sheet (handling aliases)
      let sheet = workbook.getWorksheet(rule.sheet);
      if (!sheet && rule.aliases) {
        for (const alias of rule.aliases) {
          sheet = workbook.getWorksheet(alias);
          if (sheet) break;
        }
      }

      if (!sheet) {
        if (rule.type === 'text' || rule.optional) continue;
        const availableSheets = workbook.worksheets.map((ws) => ws.name);
        throw new AppError({
          statusCode: 422,
          code: 'MISSING_SHEET',
          message: `找不到必须的工作表: "${rule.sheet}" (或其别名)。\n\n您的Excel文件中包含的工作表: ${availableSheets.join(', ')}`,
          details: { rule: rule.key, evidence: { sheet_name: rule.sheet, available_sheets: availableSheets } }
        });
      }

      if (rule.type === 'text') {
        const textValue = rule.strategy === 'first_cell'
          ? extractFirstCell(sheet)
          : extractAllContent(sheet);
        if (textValue) {
          texts.push({ key: rule.key, value_text: textValue });
        }
        continue;
      }

      // 2. Resolve Row Anchor
      let rowAnchorCell = findCellByText(sheet, rule.rowAnchor, rule.rowAnchorIndex);
      if (!rowAnchorCell && rule.rowAnchorAliases) {
        for (const alias of rule.rowAnchorAliases) {
          rowAnchorCell = findCellByText(sheet, alias, rule.rowAnchorIndex);
          if (rowAnchorCell) break;
        }
      }

      // 3. Resolve Col Anchor
      let colAnchorCell = findCellByText(sheet, rule.colAnchor, rule.colAnchorIndex);
      if (!colAnchorCell && rule.colAnchorAliases) {
        for (const alias of rule.colAnchorAliases) {
          colAnchorCell = findCellByText(sheet, alias, rule.colAnchorIndex);
          if (colAnchorCell) break;
        }
      }

      if (!rowAnchorCell || !colAnchorCell) {
        if (rule.optional) {
          continue;
        }
        throw new AppError({
          statusCode: 422,
          code: 'MISSING_ANCHOR',
          message: `Sheet "${sheet.name}" formatting incorrect. Could not find anchor: Row="${rule.rowAnchor}" (or aliases), Col="${rule.colAnchor}" (or aliases)`,
          details: { rule: rule.key }
        });
      }

      const targetRow = rowAnchorCell.row + (rule.rowOffset || 0);
      const targetCol = colAnchorCell.col + (rule.colOffset || 0);
      const targetCell = sheet.getCell(targetRow, targetCol);
      const anchorText = `row:${rule.rowAnchor}|col:${rule.colAnchor}`;

      const targetEntry = collectParsedCell(parsedCellsMap, sheet.name, targetCell, anchorText);
      const rowAnchorEntry = collectParsedCell(parsedCellsMap, sheet.name, rowAnchorCell, `row_anchor:${rule.rowAnchor}`);
      const colAnchorEntry = collectParsedCell(parsedCellsMap, sheet.name, colAnchorCell, `col_anchor:${rule.colAnchor}`);

      let normalizedNumber = normalizeNumber(getPrimitiveCellValue(targetCell), targetCell.numFmt || '');
      const extraEvidence = [];

      if ((normalizedNumber === null || normalizedNumber === 0) && Array.isArray(rule.sumCols)) {
        const { sum, evidenceCells } = sumFromCols({
          sheet,
          row: targetRow,
          colHeaders: rule.sumCols,
          parsedCellsMap,
          sheetName: sheet.name
        });
        normalizedNumber = sum;
        extraEvidence.push(...evidenceCells);
      }

      if ((normalizedNumber === null || normalizedNumber === 0) && Array.isArray(rule.sumRows)) {
        const { sum, evidenceCells } = sumFromRows({
          sheet,
          col: colAnchorCell.col,
          rowHeaders: rule.sumRows,
          parsedCellsMap,
          sheetName: sheet.name
        });
        normalizedNumber = sum;
        extraEvidence.push(...evidenceCells);
      }

      if (normalizedNumber === null) {
        if (rule.optional) {
          continue;
        }
        throw new AppError({
          statusCode: 422,
          code: 'MISSING_VALUE',
          message: `Required cell is empty for ${rule.key}`,
          details: { rule: rule.key, evidence: { sheet_name: sheet.name, cell_address: targetCell.address } }
        });
      }

      facts.push({
        key: rule.key,
        value_numeric: normalizedNumber,
        evidence_cells: [targetEntry, rowAnchorEntry, colAnchorEntry, ...extraEvidence]
      });
      resolvedKeys.add(rule.key);
    }

    const lineItemResult = parseLineItems(workbook);
    facts.push(...lineItemResult.facts);
    texts.push(...lineItemResult.texts);

    return {
      parsedCells: Array.from(parsedCellsMap.values()),
      facts,
      texts
    };
  } catch (error) {
    if (error.message && error.message.includes('Cannot merge already merged cells')) {
      throw new AppError({
        statusCode: 422,
        code: 'UNSUPPORTED_WORKBOOK_LAYOUT',
        message: 'Workbook contains unsupported merged-cell layout'
      });
    }
    throw error;
  }
};

module.exports = {
  parseBudgetWorkbook,
  normalizeNumber
};
