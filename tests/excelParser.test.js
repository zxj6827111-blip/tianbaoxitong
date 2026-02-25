const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { parseBudgetWorkbook } = require('../src/services/excelParser');

const BASIC_EXPENDITURE_RULE = {
  key: 'budget_expenditure_basic',
  sheet: '3.20部门财政拨款支出预算明细表',
  rowAnchor: '合计',
  rowAnchorIndex: -1,
  colAnchor: '人员经费',
  colAnchorAliases: ['基本支出'],
  sumCols: ['人员经费', '公用经费'],
  forceSumCols: true
};

const createTempWorkbookPath = () => path.join(
  os.tmpdir(),
  `excel-parser-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`
);

const writeWorkbook = async (workbook) => {
  const filePath = createTempWorkbookPath();
  await workbook.xlsx.writeFile(filePath);
  return filePath;
};

const writeSheetJsWorkbook = async (workbook) => {
  const filePath = createTempWorkbookPath();
  XLSX.writeFile(workbook, filePath);
  return filePath;
};

const createBasicExpenditureWorkbook = ({
  headerForTotal = '合计',
  totalValue = null,
  includePersonnel = true,
  personnelValue = null,
  includePublic = true,
  publicValue = null
} = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('3.20部门财政拨款支出预算明细表');

  sheet.getCell('A7').value = '项目';
  sheet.getCell('D7').value = headerForTotal;
  if (includePersonnel) {
    sheet.getCell('E7').value = '人员经费';
  }
  if (includePublic) {
    sheet.getCell('F7').value = '公用经费';
  }

  sheet.getCell('A21').value = '合计';
  sheet.getCell('D21').value = totalValue;
  if (includePersonnel) {
    sheet.getCell('E21').value = personnelValue;
  }
  if (includePublic) {
    sheet.getCell('F21').value = publicValue;
  }

  return workbook;
};

describe('excelParser sum fallback behavior', () => {
  it('forces basic expenditure to sum personnel + public when both are present', async () => {
    const workbook = createBasicExpenditureWorkbook({
      headerForTotal: '合计',
      totalValue: null,
      includePersonnel: true,
      personnelValue: 120,
      includePublic: true,
      publicValue: 80
    });
    const filePath = await writeWorkbook(workbook);

    try {
      const parseResult = await parseBudgetWorkbook(filePath, [BASIC_EXPENDITURE_RULE]);
      const fact = parseResult.facts.find((item) => item.key === 'budget_expenditure_basic');
      expect(fact).toBeTruthy();
      expect(Number(fact.value_numeric)).toBe(200);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  });

  it('keeps alias-based total value when personnel/public columns are not available', async () => {
    const workbook = createBasicExpenditureWorkbook({
      headerForTotal: '基本支出',
      totalValue: 360,
      includePersonnel: false,
      includePublic: false
    });
    const filePath = await writeWorkbook(workbook);

    try {
      const parseResult = await parseBudgetWorkbook(filePath, [BASIC_EXPENDITURE_RULE]);
      const fact = parseResult.facts.find((item) => item.key === 'budget_expenditure_basic');
      expect(fact).toBeTruthy();
      expect(Number(fact.value_numeric)).toBe(360);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  });

  it('throws MISSING_VALUE when target and sum sources are all empty', async () => {
    const workbook = createBasicExpenditureWorkbook({
      headerForTotal: '合计',
      totalValue: null,
      includePersonnel: true,
      personnelValue: null,
      includePublic: true,
      publicValue: null
    });
    const filePath = await writeWorkbook(workbook);

    try {
      await expect(parseBudgetWorkbook(filePath, [BASIC_EXPENDITURE_RULE])).rejects.toMatchObject({
        code: 'MISSING_VALUE'
      });
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  });

  it('resolves formula reference cell when formula result is missing', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('FormulaRef');
    sheet.getCell('A1').value = 'HEADER';
    sheet.getCell('B1').value = 'COL';
    sheet.getCell('B2').value = 456;
    sheet.getCell('A3').value = 'ROW';
    sheet.getCell('B3').value = { formula: 'B2' };

    const filePath = await writeWorkbook(workbook);
    const mapping = [{
      key: 'formula_value',
      sheet: 'FormulaRef',
      rowAnchor: 'ROW',
      colAnchor: 'COL'
    }];

    try {
      const parseResult = await parseBudgetWorkbook(filePath, mapping);
      const fact = parseResult.facts.find((item) => item.key === 'formula_value');
      expect(fact).toBeTruthy();
      expect(Number(fact.value_numeric)).toBe(456);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  });

  it('falls back to SheetJS when workbook has overlapping merged regions', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['ROW', 'COL'],
      ['ROW', 321],
      ['merged', null, null]
    ]);
    sheet['!merges'] = [
      { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'OverlapMerged');

    const filePath = await writeSheetJsWorkbook(workbook);
    const mapping = [{
      key: 'overlap_value',
      sheet: 'OverlapMerged',
      rowAnchor: 'ROW',
      rowAnchorIndex: -1,
      colAnchor: 'COL'
    }];

    try {
      const parseResult = await parseBudgetWorkbook(filePath, mapping);
      const fact = parseResult.facts.find((item) => item.key === 'overlap_value');
      expect(fact).toBeTruthy();
      expect(Number(fact.value_numeric)).toBe(321);
    } finally {
      await fs.unlink(filePath).catch(() => {});
    }
  });
});
