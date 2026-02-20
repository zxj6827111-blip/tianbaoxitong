const fs = require('node:fs/promises');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { fillExcelTemplate, __private } = require('../src/services/excelFiller');

const SECTION_PROJECT = '\u4e03\u3001\u9879\u76ee\u7ecf\u8d39\u60c5\u51b5\u8bf4\u660e';
const SECTION_PROJECT_OVERVIEW = '\u4e00\u3001\u9879\u76ee\u6982\u8ff0';
const REASON_PREFIX_INC = '\u8d22\u653f\u62e8\u6b3e\u6536\u5165\u652f\u51fa\u589e\u52a0\u7684\u4e3b\u8981\u539f\u56e0\u662f';
const REASON_PREFIX_DEC = '\u8d22\u653f\u62e8\u6b3e\u6536\u5165\u652f\u51fa\u51cf\u5c11\u7684\u4e3b\u8981\u539f\u56e0\u662f';

describe('excelFiller buildPayload', () => {
  it('always emits section seven project header even when project fields are empty', () => {
    const block = __private.buildProjectExpenseBlock({ manual_inputs: {} });
    expect(block).toContain(SECTION_PROJECT);
    expect(block).toContain(SECTION_PROJECT_OVERVIEW);
    expect(block).toContain('\n\u65e0\n');
  });

  it('includes project section in other notes for unit caliber', () => {
    const payload = __private.buildPayload({
      values: {
        manual_inputs: {
          other_notes: { value_text: 'alpha' }
        }
      },
      year: 2025,
      caliber: 'unit'
    });

    expect(payload.manualTexts.other_notes).toContain('alpha');
    expect(payload.manualTexts.other_notes).toContain(SECTION_PROJECT);
  });

  it('does not duplicate project section in other notes', () => {
    const payload = __private.buildPayload({
      values: {
        manual_inputs: {
          other_notes: { value_text: `${SECTION_PROJECT}\ncustom` }
        }
      },
      year: 2025,
      caliber: 'unit'
    });

    const occurrences = (payload.manualTexts.other_notes.match(new RegExp(SECTION_PROJECT, 'g')) || []).length;
    expect(occurrences).toBe(1);
  });

  it('builds dynamic fiscal trend reason line from manual reason', () => {
    const payload = __private.buildPayload({
      values: {
        manual_inputs: {
          budget_explanation: {
            value_text: '\u652f\u51fa\u9884\u7b97\u6bd42024\u5e74\u9884\u7b97\u51cf\u5c11\u3002\u8d22\u653f\u62e8\u6b3e\u6536\u5165\u652f\u51fa\u51cf\u5c11\u7684\u4e3b\u8981\u539f\u56e0\u662f\u65e7\u539f\u56e0\u3002'
          },
          budget_change_reason: {
            value_text: '\u9879\u76ee\u7ed3\u6784\u8c03\u6574'
          }
        }
      },
      year: 2025
    });

    expect(payload.manualTexts.explanation_block).toContain(`${REASON_PREFIX_DEC}\u9879\u76ee\u7ed3\u6784\u8c03\u6574\u3002`);
    expect(payload.manualTexts.explanation_block).not.toContain('\u65e7\u539f\u56e0');
  });

  it('uses department target sheet names when caliber is department', () => {
    const payload = __private.buildPayload({
      values: { manual_inputs: {} },
      year: 2025,
      caliber: 'department'
    });

    expect(payload.sheetNames.functions).toBe('\u90e8\u95e8\u4e3b\u8981\u804c\u80fd');
    expect(payload.sheetNames.org).toBe('\u90e8\u95e8\u673a\u6784\u8bbe\u7f6e');
    expect(payload.sheetNames.explanation).toBe('\u90e8\u95e8\u7f16\u5236\u8bf4\u660e');
    expect(payload.sheetMap.some((item) => item.target === '\u90e8\u95e8\u6536\u652f\u603b\u8868')).toBe(true);
    expect(payload.sheetMap.some((item) => item.target === '\u90e8\u95e8\u653f\u5e9c\u6027\u57fa\u91d1\u62e8\u6b3e\u8868')).toBe(true);
  });

  it('does not append project section into other notes for department caliber', () => {
    const payload = __private.buildPayload({
      values: {
        manual_inputs: {
          other_notes: { value_text: 'alpha' },
          budget_explanation: {
            value_text: '\u8d22\u653f\u62e8\u6b3e\u652f\u51fa\u9884\u7b97\u6bd42024\u5e74\u9884\u7b97\u589e\u52a0\u3002\u8d22\u653f\u62e8\u6b3e\u6536\u5165\u652f\u51fa\u51cf\u5c11\u7684\u4e3b\u8981\u539f\u56e0\u662f\u65e7\u53e3\u5f84\u3002'
          }
        }
      },
      year: 2025,
      caliber: 'department'
    });

    expect(payload.manualTexts.other_notes).toBe('alpha');
    expect(payload.manualTexts.project_expense).toContain(SECTION_PROJECT);
    expect(payload.manualTexts.explanation_block).toContain(REASON_PREFIX_INC);
    expect(payload.manualTexts.explanation_block).not.toContain(REASON_PREFIX_DEC);
  });
});

describe('excelFiller paragraph formatting', () => {
  it('splits single-line section content by Chinese section markers', () => {
    const raw = '\u4e00\u3001\u6982\u8ff0 \uff08\u4e00\uff09\u539f\u56e0A \uff08\u4e8c\uff09\u539f\u56e0B \u4e8c\u3001\u7ed3\u8bba';
    const normalized = __private.insertSectionParagraphBreaks(raw, { splitSubSections: true });
    expect(normalized).toContain('\u4e00\u3001\u6982\u8ff0\n\uff08\u4e00\uff09\u539f\u56e0A\n\uff08\u4e8c\uff09\u539f\u56e0B\n\u4e8c\u3001\u7ed3\u8bba');
  });

  it('keeps section headings and notes without first-line indent', () => {
    const formatted = __private.formatParagraphIndent('\u4e00\u3001\u6807\u9898\n\u6b63\u6587\n\u6ce8:\u5907\u6ce8');
    const lines = formatted.split('\n');
    expect(lines[0].startsWith('\u3000')).toBe(false);
    expect(lines[1].startsWith('\u3000\u3000')).toBe(true);
    expect(lines[2].startsWith('\u3000')).toBe(false);
  });

  it('supports section splitting from formatParagraphIndent options', () => {
    const formatted = __private.formatParagraphIndent('\u4e00\u3001A \u4e8c\u3001B', { splitSections: true, splitSubSections: false });
    expect(formatted).toContain('\u4e00\u3001A\n\u4e8c\u3001B');
  });

  it('indents subsection headings when glossary mode is enabled', () => {
    const formatted = __private.formatParagraphIndent('\uff08\u4e00\uff09\u540d\u8bcd\u89e3\u91ca', { indentSubSectionHeadings: true });
    expect(formatted.startsWith('\u3000\u3000')).toBe(true);
  });

  it('keeps subsection headings non-indented by default', () => {
    const formatted = __private.formatParagraphIndent('\uff08\u4e00\uff09\u540d\u8bcd\u89e3\u91ca');
    expect(formatted.startsWith('\u3000\u3000')).toBe(false);
  });

  it('can indent top-level section headings when requested', () => {
    const formatted = __private.formatParagraphIndent('\u5305\u62ec\uff1a\n\u4e00\u3001\u4e8b\u9879A', {
      indentTopLevelHeadings: true
    });
    const lines = formatted.split('\n');
    expect(lines[0].startsWith('\u3000\u3000')).toBe(true);
    expect(lines[1].startsWith('\u3000\u3000')).toBe(true);
  });
});

describe('excelFiller empty table note placement', () => {
  const parseText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object' && Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part?.text || '')).join('');
    }
    return String(value);
  };

  const buildSheetWithDuplicateTotals = () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('test');
    for (let col = 1; col <= 7; col += 1) {
      sheet.getRow(1).getCell(col).value = `H${col}`;
    }
    sheet.getCell('A10').value = '合计';
    sheet.getCell('A20').value = '合计';
    sheet.getCell('A25').value = '预留行';
    return sheet;
  };

  const hasBorder = (border) => Boolean(border && (border.top || border.bottom || border.left || border.right));

  it('defaults to first total row and prunes trailing rows', () => {
    const sheet = buildSheetWithDuplicateTotals();
    __private.setEmptyTableNote(sheet, '注:默认行为校验');

    expect(parseText(sheet.getCell('A11').value).trim()).toBe('注:默认行为校验');
    expect(parseText(sheet.getCell('A21').value).trim()).not.toBe('注:默认行为校验');
    expect(String(sheet.pageSetup?.printArea || '')).toMatch(/A1:[A-Z]+11$/);
  });

  it('can place note after the last total row without pruning rows below', () => {
    const sheet = buildSheetWithDuplicateTotals();
    __private.setEmptyTableNote(sheet, '注:底部空表说明', 7, {
      preferLastTotalRow: true,
      pruneAfterNote: false
    });

    expect(parseText(sheet.getCell('A21').value).trim()).toBe('注:底部空表说明');
    expect(parseText(sheet.getCell('A20').value).trim()).toBe('合计');
    expect(parseText(sheet.getCell('A25').value).trim()).toBe('预留行');
    expect(parseText(sheet.getCell('A11').value).trim()).not.toBe('注:底部空表说明');
    expect(String(sheet.pageSetup?.printArea || '')).toMatch(/A1:[A-Z]+25$/);
  });

  it('supports placing note outside table border and removes trailing artifact lines', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('test');
    for (let col = 1; col <= 7; col += 1) {
      sheet.getRow(1).getCell(col).value = `H${col}`;
    }

    sheet.getCell('A20').value = '合计';
    const thin = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } }
    };
    for (let col = 1; col <= 4; col += 1) {
      sheet.getRow(22).getCell(col).border = thin;
      sheet.getRow(23).getCell(col).border = thin;
    }

    __private.setEmptyTableNote(sheet, '注:空表说明', 7, {
      preferLastTotalRow: true,
      pruneAfterNote: true,
      outsideTable: true
    });

    expect(parseText(sheet.getCell('A21').value).trim()).toBe('注:空表说明');
    expect(hasBorder(sheet.getCell('A21').border)).toBe(false);
    expect(hasBorder(sheet.getCell('A22').border)).toBe(false);
    expect(hasBorder(sheet.getCell('A23').border)).toBe(false);
    expect(String(sheet.pageSetup?.printArea || '')).toMatch(/A1:[A-Z]+21$/);
  });
});

describe('excelFiller empty code table cleanup', () => {
  const parseText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object' && Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part?.text || '')).join('');
    }
    return String(value);
  };

  it('removes dot placeholder rows and keeps only the last total row', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('test');
    for (let col = 1; col <= 7; col += 1) {
      sheet.getRow(1).getCell(col).value = `H${col}`;
    }

    sheet.getCell('A10').value = '合计';
    sheet.getCell('A12').value = '…';
    sheet.getCell('D12').value = '…';
    sheet.getCell('A13').value = '...';
    sheet.getCell('D13').value = '...';
    sheet.getCell('A20').value = '合计';

    __private.cleanupEmptyCodeTableRows(sheet);

    expect(parseText(sheet.getCell('A10').value).trim()).toBe('');
    expect(parseText(sheet.getCell('A12').value).trim()).toBe('');
    expect(parseText(sheet.getCell('A13').value).trim()).toBe('');
    expect(parseText(sheet.getCell('A20').value).trim()).toBe('合计');
  });

  it('normalizes empty code table grid and total row merge', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('test');
    for (let col = 1; col <= 7; col += 1) {
      sheet.getRow(1).getCell(col).value = `H${col}`;
    }

    sheet.mergeCells('A10:D10');
    sheet.getCell('A10').value = '临时合并';
    sheet.getCell('A15').value = '...';
    sheet.getCell('D15').value = '...';
    sheet.getCell('A18').value = '合计';

    __private.normalizeEmptyCodeTableLayout(sheet);

    expect(parseText(sheet.getCell('A10').value).trim()).toBe('');
    expect(parseText(sheet.getCell('A15').value).trim()).toBe('');
    expect(parseText(sheet.getCell('A21').value).trim()).toBe('合计');
    expect((sheet.model.merges || []).includes('A21:D21')).toBe(true);
  });
});

describe('excelFiller narrative layout', () => {
  const tmpDir = path.resolve(
    __dirname,
    '..',
    '.tmp',
    `excel-filler-layout-${process.pid}-${Math.random().toString(16).slice(2)}`
  );
  const sourcePath = path.join(tmpDir, 'layout_source.xlsx');
  const outputPath = path.join(tmpDir, 'layout_output.xlsx');
  const templatePath = path.resolve(__dirname, '..', 'templates', 'excel', 'department_budget_template.xlsx');
  let workbook;

  const parseText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part?.text || '')).join('');
    }
    return String(value);
  };

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const sourceWb = new ExcelJS.Workbook();
    sourceWb.addWorksheet('Sheet1').getCell('A1').value = 'seed';
    await sourceWb.xlsx.writeFile(sourcePath);

    await fillExcelTemplate({
      templatePath,
      sourcePath,
      outputPath,
      year: 2025,
      caliber: 'department',
      values: {
        manual_inputs: {
          unit_full_name: { value_text: '\u6d4b\u8bd5\u5355\u4f4d' },
          main_functions: {
            value_text: '\u6d4b\u8bd5\u804c\u80fd\u5982\u4e0b\uff1a\n\u5305\u62ec\uff1a\n\u4e00\u3001\u4e8b\u9879A\u3002\n\u4e8c\u3001\u4e8b\u9879B\u3002\n\u4e09\u3001\u4e8b\u9879C\u3002'
          },
          organizational_structure: {
            value_text: '\u6d4b\u8bd5\u673a\u6784\u5982\u4e0b\uff1a\u4e00\u3001\u79d1\u5ba4A\u3002\u4e8c\u3001\u79d1\u5ba4B\u3002\u4e09\u3001\u79d1\u5ba4C\u3002'
          },
          glossary: {
            value_text: '\uff08\u4e00\uff09\u540d\u8bcdA\n\u89e3\u91caA\u3002\n\uff08\u4e8c\uff09\u540d\u8bcdB\n\u89e3\u91caB\u3002'
          },
          other_notes: {
            value_text: '\u4e00\u3001\u60c5\u51b5\u8bf4\u660e\n\u7b2c\u4e00\u6bb5\u6587\u5b57\u7528\u4e8e\u6821\u9a8c\u7edf\u4e00\u884c\u8ddd\u3002\n\u4e8c\u3001\u5176\u4ed6\u8bf4\u660e\n\u7b2c\u4e8c\u6bb5\u6587\u5b57\u7528\u4e8e\u6821\u9a8c\u4e0d\u4e22\u5b57\u3002'
          },
          budget_explanation: {
            value_text: '\u8d22\u653f\u62e8\u6b3e\u652f\u51fa\u9884\u7b97\u6bd42024\u5e74\u9884\u7b97\u589e\u52a0\u3002'
          },
          budget_change_reason: {
            value_text: '\u4e3b\u8981\u56e0\u9879\u76ee\u8c03\u6574'
          },
          project_overview: { value_text: '\u9879\u76ee\u6982\u8ff0\u6bb5\u843d\u3002'.repeat(6) },
          project_basis: { value_text: '\u7acb\u9879\u4f9d\u636e\u6bb5\u843d\u3002'.repeat(6) },
          project_subject: { value_text: '\u5b9e\u65bd\u4e3b\u4f53\u6bb5\u843d\u3002'.repeat(6) },
          project_plan: { value_text: '\u5b9e\u65bd\u65b9\u6848\u6bb5\u843d\u3002'.repeat(6) },
          project_cycle: { value_text: '\u5b9e\u65bd\u5468\u671f\u6bb5\u843d\u3002'.repeat(6) },
          project_budget_arrangement: { value_text: '\u9884\u7b97\u5b89\u6392\u6bb5\u843d\u3002'.repeat(6) },
          project_performance_goal: { value_text: '\u7ee9\u6548\u76ee\u6807\u6bb5\u843d\u3002'.repeat(6) }
        },
        line_items_reason: [
          {
            item_label: '\u4e00\u822c\u516c\u5171\u670d\u52a1\u652f\u51fa',
            amount_current_wanyuan: 43.83,
            reason_text: '\u4e3b\u8981\u7528\u4e8e\u4e13\u9879\u666e\u67e5\u6d3b\u52a8\u3002'
          },
          {
            item_label: '\u7fa4\u4f17\u56e2\u4f53\u4e8b\u52a1',
            amount_current_wanyuan: 42.29,
            reason_text: '\u4e3b\u8981\u7528\u4e8e\u4e00\u822c\u884c\u653f\u7ba1\u7406\u4e8b\u52a1\u3002'
          }
        ]
      }
    });

    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
  }, 60000);

  it('keeps function and organization narrative blocks in merged paragraph cells', () => {
    const functionsSheet = workbook.getWorksheet('\u90e8\u95e8\u4e3b\u8981\u804c\u80fd');
    const orgSheet = workbook.getWorksheet('\u90e8\u95e8\u673a\u6784\u8bbe\u7f6e');
    expect(functionsSheet).toBeTruthy();
    expect(orgSheet).toBeTruthy();
    expect(functionsSheet.model.merges || []).toContain('A3:A17');
    expect(orgSheet.model.merges || []).toContain('A3:A17');

    const row3Text = parseText(functionsSheet.getCell('A3').value).trim();
    expect(row3Text.length).toBeGreaterThan(20);
    expect(functionsSheet.getCell('A3').alignment?.wrapText).toBe(true);
    expect(functionsSheet.getRow(3).height).toBe(20);
    expect(parseText(functionsSheet.getCell('A3').value)).toContain('\n\u3000\u3000\u4e00\u3001');
  });

  it('keeps explanation body as line-based rows for overflow-safe pagination', () => {
    const sheet = workbook.getWorksheet('\u90e8\u95e8\u7f16\u5236\u8bf4\u660e');
    expect(sheet).toBeTruthy();

    const row3 = parseText(sheet.getCell('A3').value).trim();
    const row4 = parseText(sheet.getCell('A4').value).trim();
    expect(row3.length).toBeGreaterThan(0);
    expect(row4.length).toBeGreaterThan(0);
    expect(sheet.getCell('A3').alignment?.wrapText).not.toBe(true);
    expect((sheet.model.merges || []).some((ref) => /^A3:A\d+$/.test(ref))).toBe(false);
    expect(sheet.getRow(3).height).toBe(20);
  });

  it('keeps first-line indent for each explanation paragraph in line layout', () => {
    const sheet = workbook.getWorksheet('\u90e8\u95e8\u7f16\u5236\u8bf4\u660e');
    expect(sheet).toBeTruthy();

    let reasonLine = '';
    for (let rowNo = 3; rowNo <= 80; rowNo += 1) {
      const text = parseText(sheet.getRow(rowNo).getCell(1).value);
      if (text.includes('\u8d22\u653f\u62e8\u6b3e\u6536\u5165\u652f\u51fa\u589e\u52a0\u7684\u4e3b\u8981\u539f\u56e0\u662f')) {
        reasonLine = text;
        break;
      }
    }

    expect(reasonLine).toBeTruthy();
    expect(reasonLine.startsWith('\u3000\u3000')).toBe(true);
  });

  it('keeps narrative numbers intact without leading punctuation on wrapped lines', () => {
    const sheet = workbook.getWorksheet('\u90e8\u95e8\u7f16\u5236\u8bf4\u660e');
    expect(sheet).toBeTruthy();

    const lines = [];
    for (let rowNo = 3; rowNo <= 60; rowNo += 1) {
      const text = parseText(sheet.getRow(rowNo).getCell(1).value).trim();
      if (text) lines.push(text);
    }

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => /^\s*[,，.。]/.test(line))).toBe(false);
    expect(lines.some((line) => /\d,\s+\d|\d\.\s+\d/.test(line))).toBe(false);
  });

  it('centers narrative titles across the page width', () => {
    const sheet = workbook.getWorksheet('\u90e8\u95e8\u7f16\u5236\u8bf4\u660e');
    expect(sheet).toBeTruthy();

    const titleAlignment = sheet.getCell('A1').alignment || {};
    expect(titleAlignment.horizontal).toBe('center');
    expect(titleAlignment.vertical).toBe('middle');
    expect((sheet.model.merges || []).some((ref) => /^A1:[A-Z]+1$/.test(ref))).toBe(false);
    expect(String(sheet.pageSetup?.printArea || '')).toMatch(/^A1:A\d+$/);
    expect(Boolean(sheet.pageSetup?.horizontalCentered)).toBe(true);
  });

  it('renders cover title with uniform bold font across merged range', () => {
    const sheet = workbook.getWorksheet('\u5c01\u9762');
    expect(sheet).toBeTruthy();

    const titleCell = sheet.getCell('A3');
    expect(titleCell).toBeTruthy();

    const rich = titleCell.value && typeof titleCell.value === 'object' && Array.isArray(titleCell.value.richText)
      ? titleCell.value.richText
      : [];
    expect(rich.length).toBeGreaterThan(0);
    expect(rich.every((run) => run.font && run.font.bold === true)).toBe(true);
    expect(rich.every((run) => run.font && run.font.name === '\u9ed1\u4f53')).toBe(true);

    for (let col = 1; col <= 13; col += 1) {
      const cell = sheet.getRow(3).getCell(col);
      expect(cell.font && cell.font.bold).toBe(true);
      expect(cell.font && cell.font.name).toBe('\u9ed1\u4f53');
    }
  });

  it('normalizes narrative print area to the last meaningful row', () => {
    const sheet = workbook.getWorksheet('\u5176\u4ed6\u76f8\u5173\u60c5\u51b5\u8bf4\u660e');
    expect(sheet).toBeTruthy();

    const printArea = String(sheet.pageSetup?.printArea || '');
    expect(printArea).toMatch(/^A1:[A-Z]+\d+$/);
    const match = printArea.match(/(\d+)$/);
    expect(match).toBeTruthy();
    const printEndRow = Number(match[1]);

    const mergeRef = (sheet.model.merges || []).find((ref) => /^A3:A\d+$/.test(ref));
    expect(mergeRef).toBeTruthy();
    const mergeEndRow = Number(String(mergeRef).split(':')[1].replace('A', ''));
    expect(printEndRow).toBeGreaterThanOrEqual(mergeEndRow);
    expect(printEndRow).toBeLessThanOrEqual(mergeEndRow + 1);
  });

  it('expands explanation print area to include all written rows', () => {
    const sheet = workbook.getWorksheet('\u90e8\u95e8\u7f16\u5236\u8bf4\u660e');
    expect(sheet).toBeTruthy();

    const printArea = String(sheet.pageSetup?.printArea || '');
    expect(printArea).toMatch(/^A1:[A-Z]+\d+$/);
    const match = printArea.match(/(\d+)$/);
    expect(match).toBeTruthy();
    const printEndRow = Number(match[1]);

    let lastTextRow = 1;
    for (let rowNo = 1; rowNo <= sheet.actualRowCount; rowNo += 1) {
      const text = parseText(sheet.getRow(rowNo).getCell(1).value).trim();
      if (text) lastTextRow = rowNo;
    }
    expect(printEndRow).toBeGreaterThanOrEqual(lastTextRow);
    expect(printEndRow).toBeLessThanOrEqual(lastTextRow + 1);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
