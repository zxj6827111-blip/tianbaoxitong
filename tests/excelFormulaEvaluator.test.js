const XLSX = require('xlsx');
const { recalculateSheetFormulaCells } = require('../src/services/excelFormulaEvaluator');

describe('excelFormulaEvaluator', () => {
  it('recalculates SUM with same-row column refs and direct add formulas', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['name', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      ['r2', '', '', '', 0, 1, 2, 3, 4]
    ]);

    sheet.E2 = { t: 'n', v: 0, f: 'SUM(F,G,H,I)' };
    sheet.D2 = { t: 'n', v: 0, f: 'F+G' };

    recalculateSheetFormulaCells(sheet);

    expect(sheet.E2.v).toBe(10);
    expect(sheet.E2.w).toBe('10');
    expect(sheet.D2.v).toBe(3);
    expect(sheet.D2.w).toBe('3');
  });

  it('recalculates ranges and formula dependencies between formula cells', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['name', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      ['r2', '', '', '', 0, 1, 2, 3, 4],
      ['r3', '', '', '', 0, 5, 6, 7, 8]
    ]);

    sheet.E3 = { t: 'n', v: 0, f: 'SUM($F$3:$I$3)' };
    sheet.D3 = { t: 'n', v: 0, f: 'E3+F3' };

    recalculateSheetFormulaCells(sheet);

    expect(sheet.E3.v).toBe(26);
    expect(sheet.D3.v).toBe(31);
  });

  it('supports direct cell references and keeps display format from cell.z', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['label', 'income', 'unused', 'expense', 'p1', 'p2', 'p3'],
      ['top', 0, '', 0, 1000.12, 2000.34, 3000.56],
      ['bottom', 0, '', 0, '', '', '']
    ]);

    sheet.B2 = { t: 'n', v: 0, f: 'SUM(E2:G2)', z: '#,##0.00' };
    sheet.D2 = { t: 'n', v: 0, f: 'SUM(E2,F2,G2)', z: '#,##0.00' };
    sheet.B3 = { t: 'n', v: 0, f: 'B2', z: '#,##0.00' };
    sheet.D3 = { t: 'n', v: 0, f: 'D2', z: '#,##0.00' };

    recalculateSheetFormulaCells(sheet);

    expect(sheet.B2.v).toBe(6001.02);
    expect(sheet.B3.v).toBe(6001.02);
    expect(sheet.B3.w).toBe('6,001.02');
    expect(sheet.D3.w).toBe('6,001.02');
  });

  it('rounds floating point artifacts and respects two-decimal format', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['total', 'outbound', 'reception', 'subtotal', 'purchase', 'operation'],
      [0, 0, 1.35, 0, 15, 21.56]
    ]);

    sheet.D2 = { t: 'n', v: 0, f: 'SUM(E2,F2)', z: '#,##0.00' };
    sheet.A2 = { t: 'n', v: 0, f: 'SUM(B2,C2,D2)', z: '#,##0.00' };

    recalculateSheetFormulaCells(sheet);

    expect(sheet.A2.v).toBe(37.91);
    expect(sheet.A2.w).toBe('37.91');
  });
});
