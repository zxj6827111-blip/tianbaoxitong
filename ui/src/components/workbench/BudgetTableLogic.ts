
// Logic extracted and adapted from ui/src/components/admin/TableDataViewer.tsx
// to ensure consistent "Official Report" style rendering in Workbench.

export interface HeaderCell {
    text: string;
    colSpan?: number;
    rowSpan?: number;
}

export interface StructuredTableView {
    colCount: number;
    numericColumns: number[];
    meta: {
        orgLabel: string;
        orgValue: string;
        unitValue: string;
    };
    headerRows: HeaderCell[][];
    bodyRows: string[][];
    fillMissingNumericWithZero?: boolean;
}

const toCellText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const isNumericLike = (value: string): boolean => {
    const normalized = String(value || '').replace(/,/g, '').trim();
    if (!normalized) return false;
    return /^[-+]?\d+(\.\d+)?$/.test(normalized) || /^\([-+]?\d+(\.\d+)?\)$/.test(normalized);
};

const isSummaryLabel = (value: string): boolean => /^(合计|总计|小计)$/.test(String(value || '').trim());
const isCodeToken = (value: string): boolean => /^\d{1,4}$/.test(String(value || '').trim());
const countNumericCells = (row: string[]) => row.filter((cell) => isNumericLike(cell)).length;
const isIncomeSideLabel = (value: string): boolean => /(收入总计|财政拨款收入|一般公共预算资金|政府性基金|国有资本经营预算)/.test(String(value || '').trim()) && !/支出/.test(String(value || '').trim());
const isExpenditureSideLabel = (value: string): boolean => /(支出总计|支出)/.test(String(value || '').trim());

const padRow = (row: string[], colCount: number): string[] => {
    const source = Array.isArray(row) ? row : [];
    return Array.from({ length: colCount }, (_, idx) => toCellText(source[idx]));
};

const extractTableMeta = (rows: string[]) => {
    let orgLabel = '编制部门';
    let orgValue = '';
    let unitValue = '';

    const rowList = Array.isArray(rows) ? rows : [];
    for (const line of rowList) {
        const text = toCellText(line);
        if (!text) continue;

        const orgMatch = text.match(/(编制(?:部门|单位))[:：]?\s*(.*)/);
        if (orgMatch) {
            orgLabel = orgMatch[1] || orgLabel;
            const candidate = toCellText(orgMatch[2]).replace(/单位[:：].*$/, '').trim();
            if (candidate && !/^单位[:：]?/.test(candidate)) {
                orgValue = candidate;
            }
        }

        const unitMatch = text.match(/单位[:：]?\s*(万?元)/);
        if (unitMatch) {
            unitValue = unitMatch[1];
        }
    }

    return { orgLabel, orgValue, unitValue };
};

interface CodeTableSpec {
    colCount: number;
    codeCols: number;
    numericCols: number;
    sectionLabel: string;
    codeLabel: string;
    nameLabel: string;
    codeLeafLabels: string[];
    numericLabels: string[];
}

const CODE_TABLE_SPECS: Record<string, CodeTableSpec> = {
    income_summary: {
        colCount: 9,
        codeCols: 3,
        numericCols: 5,
        sectionLabel: '收入预算',
        codeLabel: '功能分类科目编码',
        nameLabel: '功能分类科目名称',
        codeLeafLabels: ['类', '款', '项'],
        numericLabels: ['合计', '财政拨款收入', '事业收入', '事业单位经营收入', '其他收入']
    },
    expenditure_summary: {
        colCount: 7,
        codeCols: 3,
        numericCols: 3,
        sectionLabel: '支出预算',
        codeLabel: '功能分类科目编码',
        nameLabel: '功能分类科目名称',
        codeLeafLabels: ['类', '款', '项'],
        numericLabels: ['合计', '基本支出', '项目支出']
    },
    general_budget: {
        colCount: 7,
        codeCols: 3,
        numericCols: 3,
        sectionLabel: '一般公共预算支出',
        codeLabel: '功能分类科目编码',
        nameLabel: '功能分类科目名称',
        codeLeafLabels: ['类', '款', '项'],
        numericLabels: ['合计', '基本支出', '项目支出']
    },
    gov_fund_budget: {
        colCount: 7,
        codeCols: 3,
        numericCols: 3,
        sectionLabel: '政府性基金预算支出',
        codeLabel: '功能分类科目编码',
        nameLabel: '功能分类科目名称',
        codeLeafLabels: ['类', '款', '项'],
        numericLabels: ['合计', '基本支出', '项目支出']
    },
    capital_budget: {
        colCount: 7,
        codeCols: 3,
        numericCols: 3,
        sectionLabel: '国有资本经营预算支出',
        codeLabel: '功能分类科目编码',
        nameLabel: '功能分类科目名称',
        codeLeafLabels: ['类', '款', '项'],
        numericLabels: ['合计', '基本支出', '项目支出']
    },
    basic_expenditure: {
        colCount: 6,
        codeCols: 2,
        numericCols: 3,
        sectionLabel: '一般公共预算基本支出',
        codeLabel: '部门预算经济分类科目编码',
        nameLabel: '经济分类科目名称',
        codeLeafLabels: ['类', '款'],
        numericLabels: ['合计', '人员经费', '公用经费']
    }
};

const isCodeTableHeaderNoise = (text: string): boolean => {
    const merged = toCellText(text);
    if (!merged) return true;
    if (/^(编制部门|编制单位|单位[:：])/.test(merged)) return true;
    if (/^(项目|功能分类科目编码|部门预算经济分类科目编码|经济分类科目编码|功能分类科目名称|经济分类科目名称)$/.test(merged)) return true;
    if (/^(类|款|项)$/.test(merged)) return true;
    return false;
};

const alignCodeTableRow = (row: string[], spec: CodeTableSpec): string[] => {
    const out = Array(spec.colCount).fill('');

    // 1. Handle Numbers (Strict Positional from the end defined by spec)
    // We trust that the numeric columns are fixed at the end of the matching row.
    const numericStartIdx = spec.colCount - spec.numericCols;
    for (let i = 0; i < spec.numericCols; i++) {
        const rowIdx = numericStartIdx + i;
        const val = toCellText(row[rowIdx]);
        // If the cell is numeric, use it. If empty, default to '0' to ensure alignment.
        // If it contains text (unexpected), we might keep it or zero it. 
        // For safety, if it looks numeric use it, otherwise '0'.
        out[numericStartIdx + i] = isNumericLike(val) ? val : '0';
    }

    // 2. Handle Codes and Name (Left side)
    // Extract the left part of the row (codes + name area)
    const leftSide = row.slice(0, numericStartIdx).map(toCellText).filter(Boolean);

    if (leftSide.length === 0) return out;

    // Check for Summary line
    if (isSummaryLabel(leftSide[0])) {
        out[0] = leftSide[0];
        // Summary lines might have nums in standard slots (handled above) 
        // OR they might specific alignment. 
        // Usually Code Table summary lines align with standard numeric columns.
        return out;
    }

    // Distribute tokens into Code columns
    let cursor = 0;
    while (cursor < leftSide.length && cursor < spec.codeCols && isCodeToken(leftSide[cursor])) {
        out[cursor] = leftSide[cursor];
        cursor++;
    }

    // The next token is likely the Name
    if (cursor < leftSide.length) {
        out[spec.codeCols] = leftSide[cursor];
    } else {
        // If we ran out of tokens, maybe the name was missing or it was all codes?
        // Just leave name empty.
    }

    return out;
};

const buildBudgetSummaryView = (rows: string[][], metaRows: string[]): StructuredTableView => {
    const colCount = 4;
    const normalizedRows = rows.map((row) => padRow(row, colCount));

    const bodyRows = normalizedRows
        .map((row) => {
            const raw = row.map(toCellText);
            const merged = raw.join('');
            if (!merged) return null;
            if (/^(编制部门|编制单位|单位[:：])/.test(merged)) return null;
            if (merged.includes('本年收入') || merged.includes('本年支出')) return null;
            if (merged === '项目预算数项目预算数') return null;

            const values = raw.filter(Boolean);
            const labels = values.filter((token) => !isNumericLike(token));
            const nums = values.filter((token) => isNumericLike(token));
            const out = ['', '', '', ''];

            if (labels.length >= 2 && nums.length >= 2) {
                out[0] = labels[0];
                out[1] = nums[0];
                out[2] = labels[1];
                out[3] = nums[1];
                return out;
            }

            if (labels.length >= 2 && nums.length === 1) {
                out[0] = labels[0];
                out[2] = labels[1];
                out[3] = nums[0];
                return out;
            }

            if (labels.length === 1 && nums.length === 1) {
                if (isExpenditureSideLabel(labels[0]) && !/收入/.test(labels[0])) {
                    out[2] = labels[0];
                    out[3] = nums[0];
                } else {
                    out[0] = labels[0];
                    out[1] = nums[0];
                }
                return out;
            }

            if (labels.length === 1 && nums.length === 0) {
                if (isExpenditureSideLabel(labels[0]) && !/收入/.test(labels[0])) {
                    out[2] = labels[0];
                } else {
                    out[0] = labels[0];
                }
                return out;
            }

            return null;
        });

    const compactBodyRows = bodyRows.filter((row): row is string[] => Array.isArray(row) && row.some((cell) => toCellText(cell)));

    if (compactBodyRows.length === 0) {
        bodyRows.push(['收入总计', '0', '支出总计', '0']);
    }

    return {
        colCount,
        numericColumns: [1, 3],
        meta: extractTableMeta(metaRows),
        headerRows: [
            [
                { text: '本年收入', colSpan: 2 },
                { text: '本年支出', colSpan: 2 }
            ],
            [
                { text: '项目' },
                { text: '预算数' },
                { text: '项目' },
                { text: '预算数' }
            ]
        ],
        bodyRows: compactBodyRows.length > 0 ? compactBodyRows : [['收入总计', '0', '支出总计', '0']],
        fillMissingNumericWithZero: false
    };
};

const buildFiscalGrantSummaryView = (rows: string[][], metaRows: string[]): StructuredTableView => {
    const colCount = 7;
    const normalizedRows = rows.map((row) => padRow(row, colCount));

    const bodyRows = normalizedRows
        .map((row) => {
            const raw = row.map(toCellText);
            const merged = raw.join('');
            if (!merged) return null;
            if (/^(编制部门|编制单位|单位[:：])/.test(merged)) return null;
            if (merged.includes('财政拨款收入') && merged.includes('财政拨款支出') && countNumericCells(raw) === 0) return null;
            if (merged.includes('一般公共预算') && merged.includes('政府性基金预算') && merged.includes('国有资本经营预算')) return null;
            if (merged === '项目预算数项目合计一般公共预算政府性基金预算国有资本经营预算') return null;

            const out = Array(colCount).fill('');

            // Identify known labels to help anchor the row type
            const hasIncomeLabel = raw.some(c => isIncomeSideLabel(c));
            const hasExpenditureLabel = raw.some(c => isExpenditureSideLabel(c));

            // Strategy: Use column indices as primary source of truth if the structure looks standard (7 cols)

            // Case 1: Full row (Left: Income Item/Value, Right: Exp Item/Values)
            // Indices: 0:IncItem, 1:IncVal, 2:ExpItem, 3:Total, 4:General, 5:Fund, 6:Capital
            // Check if ExpItem is at index 2
            if (isExpenditureSideLabel(raw[2]) || (raw[2] && !isNumericLike(raw[2]) && (hasIncomeLabel || isNumericLike(raw[1])))) {
                out[0] = raw[0];
                out[1] = isNumericLike(raw[1]) ? raw[1] : '';
                out[2] = raw[2];
                out[3] = isNumericLike(raw[3]) ? raw[3] : '';
                out[4] = isNumericLike(raw[4]) ? raw[4] : '';
                out[5] = isNumericLike(raw[5]) ? raw[5] : '';
                out[6] = isNumericLike(raw[6]) ? raw[6] : '';
                return out;
            }

            // Case 2: Income Only (Left side)
            // Indices: 0:IncItem, 1:IncVal. Others empty.
            if (hasIncomeLabel && !hasExpenditureLabel && !raw[2]) {
                out[0] = raw[0];
                out[1] = isNumericLike(raw[1]) ? raw[1] : '';
                return out;
            }

            // Case 3: Expenditure Only (Right side)
            // Indices: 2:ExpItem, 3:Total, ...
            if (hasExpenditureLabel && !hasIncomeLabel) {
                if (isExpenditureSideLabel(raw[2])) {
                    out[2] = raw[2];
                    out[3] = isNumericLike(raw[3]) ? raw[3] : '';
                    out[4] = isNumericLike(raw[4]) ? raw[4] : '';
                    out[5] = isNumericLike(raw[5]) ? raw[5] : '';
                    out[6] = isNumericLike(raw[6]) ? raw[6] : '';
                    return out;
                }
            }

            // Fallback for "clean" rows that just have values/labels in correct slots
            // Just copy 1-to-1 if it looks reasonable
            if (isNumericLike(raw[1]) || isNumericLike(raw[3])) {
                for (let i = 0; i < colCount; i++) {
                    out[i] = raw[i];
                }
                return out;
            }

            return null;
        });

    const compactBodyRows = bodyRows.filter((row): row is string[] => Array.isArray(row) && row.some((cell) => toCellText(cell)));

    return {
        colCount,
        numericColumns: [1, 3, 4, 5, 6],
        meta: extractTableMeta(metaRows),
        headerRows: [
            [
                { text: '财政拨款收入', colSpan: 2 },
                { text: '财政拨款支出', colSpan: 5 }
            ],
            [
                { text: '项目' },
                { text: '预算数' },
                { text: '项目' },
                { text: '合计' },
                { text: '一般公共预算' },
                { text: '政府性基金预算' },
                { text: '国有资本经营预算' }
            ]
        ],
        bodyRows: compactBodyRows.length > 0 ? compactBodyRows : [['财政拨款收入合计', '', '财政拨款支出合计', '0', '0', '', '']],
        fillMissingNumericWithZero: false
    };
};

const buildCodeTableView = (tableKey: string, rows: string[][], metaRows: string[]): StructuredTableView | null => {
    const spec = CODE_TABLE_SPECS[tableKey];
    if (!spec) return null;

    const normalizedRows = rows.map((row) => padRow(row, spec.colCount));
    const bodyRows = normalizedRows
        .filter((row) => {
            const first = row.find((cell) => toCellText(cell)) || '';
            const merged = row.join('');
            if (countNumericCells(row) === 0) return false;
            if (isCodeTableHeaderNoise(first)) return false;
            if (/^(项目|功能分类科目编码|部门预算经济分类科目编码|经济分类科目编码)$/.test(first)) return false;
            if (/^(功能分类科目名称|经济分类科目名称)$/.test(first)) return false;
            if (/^(编制部门|编制单位|单位[:：])/.test(merged)) return false;
            return true;
        })
        .map((row) => alignCodeTableRow(row, spec));

    if (bodyRows.length === 0) {
        const zero = Array(spec.colCount).fill('');
        zero[0] = '合计';
        for (let idx = spec.colCount - spec.numericCols; idx < spec.colCount; idx += 1) {
            zero[idx] = '0';
        }
        bodyRows.push(zero);
    }

    const headerRows: HeaderCell[][] = [
        [
            { text: '项目', colSpan: spec.codeCols + 1 },
            { text: spec.sectionLabel, colSpan: spec.numericCols }
        ],
        [
            { text: spec.codeLabel, colSpan: spec.codeCols },
            { text: spec.nameLabel, rowSpan: 2 },
            ...spec.numericLabels.map((label) => ({ text: label, rowSpan: 2 }))
        ],
        spec.codeLeafLabels.map((label) => ({ text: label }))
    ];

    return {
        colCount: spec.colCount,
        numericColumns: Array.from({ length: spec.numericCols }, (_, i) => spec.colCount - spec.numericCols + i),
        meta: extractTableMeta(metaRows),
        headerRows,
        bodyRows
    };
};

const buildThreePublicView = (rows: string[][], metaRows: string[]): StructuredTableView => {
    const colCount = 7;
    const bodyRows = rows
        .map((sourceRow) => {
            const row = Array.isArray(sourceRow) ? sourceRow.map((cell) => String(cell ?? '').trim()) : [];
            if (row.every(c => !c)) return null;

            if (row.some(c => c.includes('三公') || c.includes('机关运行') || c.includes('购置费') || c.includes('运行费'))) return null;

            const hasNumeric = row.some(c => isNumericLike(c));
            if (!hasNumeric) return null;

            const out = Array(colCount).fill('0');
            for (let i = 0; i < colCount; i++) {
                if (i < row.length) {
                    const val = row[i];
                    out[i] = isNumericLike(val) ? val : '0';
                }
            }

            // Excel formula cells (合计 and 小计) are often empty because XLSX reads with cellFormula:false.
            // We need to compute them from component values.
            const toNum = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

            // 小计(col 3) = 购置费(col 4) + 运行费(col 5) if 小计 is 0 but components are not
            const purchase = toNum(out[4]);
            const opCost = toNum(out[5]);
            const subtotal = toNum(out[3]);
            if (subtotal === 0 && (purchase > 0 || opCost > 0)) {
                out[3] = (purchase + opCost).toFixed(2).replace(/\.?0+$/, '');
            }

            // 合计(col 0) = 因公出国费(col 1) + 公务接待费(col 2) + 小计(col 3) if 合计 is 0 but components are not
            const outbound = toNum(out[1]);
            const reception = toNum(out[2]);
            const vehicleSubtotal = toNum(out[3]);
            const total = toNum(out[0]);
            if (total === 0 && (outbound > 0 || reception > 0 || vehicleSubtotal > 0)) {
                out[0] = (outbound + reception + vehicleSubtotal).toFixed(2).replace(/\.?0+$/, '');
            }

            return out;
        })
        .filter((row): row is string[] => row !== null);

    if (bodyRows.length === 0) {
        bodyRows.push(Array(colCount).fill('0'));
    }

    const headerRows: HeaderCell[][] = [
        [
            { text: '“三公”经费预算数', colSpan: 6 },
            { text: '机关运行经费预算数', rowSpan: 3 }
        ],
        [
            { text: '合计', rowSpan: 2 },
            { text: '因公出国(境)费', rowSpan: 2 },
            { text: '公务接待费', rowSpan: 2 },
            { text: '公务用车购置及运行费', colSpan: 3 }
        ],
        [
            { text: '小计' },
            { text: '购置费' },
            { text: '运行费' }
        ]
    ];

    return {
        colCount,
        numericColumns: [0, 1, 2, 3, 4, 5, 6],
        meta: extractTableMeta(metaRows),
        headerRows,
        bodyRows
    };
};

export const buildStructuredView = (tableKey: string, rows: string[][]): StructuredTableView | null => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const metaRows = rows.map((row) => row.join(' ')); // For meta extraction

    if (tableKey === 'budget_summary') {
        return buildBudgetSummaryView(rows, metaRows);
    }
    if (tableKey === 'fiscal_grant_summary') {
        return buildFiscalGrantSummaryView(rows, metaRows);
    }
    if (tableKey === 'three_public') {
        return buildThreePublicView(rows, metaRows);
    }
    if (CODE_TABLE_SPECS[tableKey]) {
        return buildCodeTableView(tableKey, rows, metaRows);
    }
    return null;
};

// Heuristic to map Chinese titles to internal keys
export const inferTableKey = (title: string): string => {
    if (title.includes('收入预算总表') && !title.includes('财政拨款') && !title.includes('收支')) return 'income_summary';
    if (title.includes('支出预算总表') && !title.includes('财政拨款') && !title.includes('收支')) return 'expenditure_summary';
    if (title.includes('财政拨款收支预算总表')) return 'fiscal_grant_summary';
    if (title.includes('一般公共预算支出功能分类预算表')) return 'general_budget';
    if (title.includes('政府性基金预算支出功能分类预算表')) return 'gov_fund_budget';
    if (title.includes('国有资本经营预算支出功能分类预算表')) return 'capital_budget';
    if (title.includes('经济分类预算表')) return 'basic_expenditure';
    if (title.includes('“三公”经费') || title.includes('三公经费')) return 'three_public';
    if (title.includes('财务收支预算总表')) return 'budget_summary';
    return '';
};
