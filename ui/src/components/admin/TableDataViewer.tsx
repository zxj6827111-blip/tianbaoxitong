import React, { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';

interface TableData {
    id: string;
    table_key: string;
    table_title: string | null;
    page_numbers: number[] | null;
    row_count: number;
    col_count: number;
    data_json: string[][] | null;
}

interface Props {
    tables: TableData[];
}

interface HeaderCell {
    text: string;
    colSpan?: number;
    rowSpan?: number;
}

interface StructuredTableView {
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

const TABLE_LABEL: Record<string, string> = {
    budget_summary: '表一 收支预算总表',
    income_summary: '表二 收入预算表',
    expenditure_summary: '表三 支出预算表',
    fiscal_grant_summary: '表四 财政拨款收支预算总表',
    general_budget: '表五 一般公共预算支出功能分类预算表',
    gov_fund_budget: '表六 政府性基金预算支出功能分类预算表',
    capital_budget: '表七 国有资本经营预算支出功能分类预算表',
    basic_expenditure: '表八 一般公共预算基本支出部门预算经济分类预算表',
    three_public: '表九 “三公”经费和机关运行经费预算表',

    // Backward-compatible keys from older parsing versions.
    fiscal_grant_expenditure: '表五 一般公共预算支出预算表',
    gov_fund_expenditure: '表六 政府性基金支出预算表',
    fiscal_transfer_expenditure: '表七 财政拨款转移支付支出预算表',
    gov_purchase: '表九 政府采购预算表'
};

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
    const tokens = row.map(toCellText).filter(Boolean);
    const numericStart = spec.colCount - spec.numericCols;
    if (tokens.length === 0) return out;

    if (isSummaryLabel(tokens[0])) {
        out[0] = tokens[0];
        const nums = tokens.slice(1).filter((token) => isNumericLike(token));
        for (let i = 0; i < spec.numericCols; i += 1) {
            out[numericStart + i] = nums[i] || '0';
        }
        return out;
    }

    let cursor = 0;
    const codes: string[] = [];
    while (cursor < tokens.length && codes.length < spec.codeCols && isCodeToken(tokens[cursor])) {
        codes.push(tokens[cursor]);
        cursor += 1;
    }
    codes.forEach((code, idx) => {
        out[idx] = code;
    });

    const remain = tokens.slice(cursor);
    const firstTextIndex = remain.findIndex((token) => !isNumericLike(token));
    let name = '';
    if (firstTextIndex >= 0) {
        name = remain[firstTextIndex];
        remain.splice(firstTextIndex, 1);
    } else {
        name = tokens.find((token) => !isNumericLike(token) && !isCodeToken(token)) || '';
    }
    out[spec.codeCols] = name;

    const nums = remain.filter((token) => isNumericLike(token));
    for (let i = 0; i < spec.numericCols; i += 1) {
        out[numericStart + i] = nums[i] || '0';
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

            const values = raw.filter(Boolean);
            const labels = values.filter((token) => !isNumericLike(token));
            const nums = values.filter((token) => isNumericLike(token));
            const out = Array(colCount).fill('');

            // 5+列标准行: 左项目,左预算,右项目,合计,一般公共预算,(可选)政府基金,(可选)国资
            if (raw[2] && isExpenditureSideLabel(raw[2])) {
                out[0] = raw[0] || '';
                out[1] = isNumericLike(raw[1]) ? raw[1] : '';
                out[2] = raw[2];
                out[3] = isNumericLike(raw[3]) ? raw[3] : '';
                out[4] = isNumericLike(raw[4]) ? raw[4] : '';
                out[5] = isNumericLike(raw[5]) ? raw[5] : '';
                out[6] = isNumericLike(raw[6]) ? raw[6] : '';
                return out;
            }

            // 4列短行: 左项目,右项目,合计,一般公共预算
            if (raw[1] && isExpenditureSideLabel(raw[1]) && isIncomeSideLabel(raw[0])) {
                out[0] = raw[0];
                out[2] = raw[1];
                out[3] = isNumericLike(raw[2]) ? raw[2] : '';
                out[4] = isNumericLike(raw[3]) ? raw[3] : '';
                return out;
            }

            // 右侧独立行: 右项目,合计,一般公共预算,(可选)政府基金,(可选)国资
            if (raw[0] && isExpenditureSideLabel(raw[0])) {
                out[2] = raw[0];
                out[3] = isNumericLike(raw[1]) ? raw[1] : '';
                out[4] = isNumericLike(raw[2]) ? raw[2] : '';
                out[5] = isNumericLike(raw[3]) ? raw[3] : '';
                out[6] = isNumericLike(raw[4]) ? raw[4] : '';
                return out;
            }

            // 左侧独立行: 左项目,左预算
            if (raw[0] && isIncomeSideLabel(raw[0])) {
                out[0] = raw[0];
                out[1] = isNumericLike(raw[1]) ? raw[1] : '';
                return out;
            }

            // 回退兜底（避免漏抓）
            if (labels.length > 0 || nums.length > 0) {
                if (labels[0] && isIncomeSideLabel(labels[0])) out[0] = labels[0];
                if (labels[0] && isExpenditureSideLabel(labels[0])) out[2] = labels[0];
                if (labels[1] && !out[2]) out[2] = labels[1];
                out[1] = nums[0] || '';
                out[3] = nums[1] || '';
                out[4] = nums[2] || '';
                out[5] = nums[3] || '';
                out[6] = nums[4] || '';
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
        .filter((row) => countNumericCells(row) >= 2)
        .map((sourceRow) => {
            const row = Array.isArray(sourceRow)
                ? sourceRow.map((cell) => String(cell ?? '').trim())
                : [];
            const nums = row.filter((cell) => isNumericLike(cell));
            const out = Array(colCount).fill('0');
            if (row.length >= 7) {
                for (let i = 0; i < colCount; i += 1) {
                    out[i] = isNumericLike(row[i]) ? row[i] : '0';
                }
                return out;
            }

            // Common sparse OCR row in this project:
            // [合计, 公务用车购置及运行费(小计), 公务接待费, 机关运行经费]
            if (nums.length === 4) {
                out[0] = nums[0] || '0';
                out[1] = nums[1] || '0';
                out[2] = nums[2] || '0';
                out[3] = '0';
                out[4] = '0';
                out[5] = '0';
                out[6] = nums[3] || '0';
                return out;
            }

            if (nums.length === 3) {
                out[0] = nums[0] || '0';
                out[1] = '0';
                out[2] = nums[1] || '0';
                out[3] = '0';
                out[4] = '0';
                out[5] = '0';
                out[6] = nums[2] || '0';
                return out;
            }

            for (let i = 0; i < Math.min(colCount, nums.length); i += 1) {
                out[i] = nums[i] || '0';
            }
            return out;
        });

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

const buildStructuredView = (tableKey: string, rows: string[][]): StructuredTableView | null => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    if (tableKey === 'budget_summary') {
        return buildBudgetSummaryView(rows, rows.map((row) => row.join(' ')));
    }
    if (tableKey === 'fiscal_grant_summary') {
        return buildFiscalGrantSummaryView(rows, rows.map((row) => row.join(' ')));
    }
    if (tableKey === 'three_public') {
        return buildThreePublicView(rows, rows.map((row) => row.join(' ')));
    }
    if (CODE_TABLE_SPECS[tableKey]) {
        return buildCodeTableView(tableKey, rows, rows.map((row) => row.join(' ')));
    }
    return null;
};

const TableDataViewer: React.FC<Props> = ({ tables }) => {
    const [showAll, setShowAll] = useState(false);

    const visibleTables = tables.filter((t) => showAll || TABLE_LABEL[t.table_key]);

    const [activeTableKey, setActiveTableKey] = useState<string | null>(
        visibleTables.length > 0 ? visibleTables[0].table_key : null
    );

    // Update active key when tables change if current is invalid
    React.useEffect(() => {
        if (!activeTableKey || !visibleTables.find(t => t.table_key === activeTableKey)) {
            setActiveTableKey(visibleTables.length > 0 ? visibleTables[0].table_key : null);
        }
    }, [visibleTables, activeTableKey]);

    if (tables.length === 0) {
        return (
            <div className="p-8 text-center text-slate-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>暂无表格数据</p>
            </div>
        );
    }

    if (visibleTables.length === 0 && !showAll) {
        return (
            <div className="p-8 text-center text-slate-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>暂无标准预算表格数据</p>
                <button
                    onClick={() => setShowAll(true)}
                    className="mt-2 text-xs text-brand-600 hover:underline"
                >
                    显示所有 {tables.length} 张原始表格
                </button>
            </div>
        );
    }

    const activeTable = visibleTables.find((t) => t.table_key === activeTableKey);
    const activeRows = Array.isArray(activeTable?.data_json) ? activeTable.data_json : [];
    const normalizedColCount = Math.max(
        Number(activeTable?.col_count) || 0,
        ...activeRows.map((row) => (Array.isArray(row) ? row.length : 0)),
        0
    );
    const normalizedRows = activeRows.map((row) => {
        const source = Array.isArray(row) ? row : [];
        return Array.from({ length: normalizedColCount }, (_, idx) => toCellText(source[idx]));
    });
    const tableHasNumericRows = normalizedRows.some((row) => row.some((cell) => isNumericLike(cell)));
    const structuredView = useMemo(
        () => (activeTable ? buildStructuredView(activeTable.table_key, normalizedRows) : null),
        [activeTable, normalizedRows]
    );
    const displayColCount = structuredView?.colCount || normalizedColCount || activeTable?.col_count || 0;
    const displayTitle = activeTable
        ? (activeTable.table_title && activeTable.table_title.trim())
            || TABLE_LABEL[activeTable.table_key]
            || activeTable.table_key
        : '';

    return (
        <div className="flex flex-col h-full">
            {/* Tab 栏 */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
                <label className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-600 border-r border-slate-300 mr-2 shrink-0 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={showAll}
                        onChange={e => setShowAll(e.target.checked)}
                        className="rounded border-slate-300 text-brand-600 focus:ring-0"
                    />
                    显示全部
                </label>
                {visibleTables.map((table) => {
                    const label = TABLE_LABEL[table.table_key] || table.table_title || table.table_key;
                    const isActive = table.table_key === activeTableKey;
                    return (
                        <button
                            key={table.table_key}
                            type="button"
                            onClick={() => setActiveTableKey(table.table_key)}
                            className={`
                shrink-0 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap
                ${isActive
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                }
              `}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>

            {/* 表格内容区 */}
            <div className="flex-1 overflow-auto p-4 bg-white">
                {activeTable ? (
                    <div>
                        {/* 表格标题和元信息 */}
                        <div className="mb-3">
                            <h3 className={`font-semibold text-slate-800 ${structuredView ? 'text-lg text-center' : 'text-sm'}`}>
                                {displayTitle}
                            </h3>
                            {activeTable.page_numbers && activeTable.page_numbers.length > 0 && (
                                <p className={`text-xs text-slate-500 mt-0.5 ${structuredView ? 'text-left' : ''}`}>
                                    页码: {activeTable.page_numbers.join(', ')}
                                </p>
                            )}
                            {structuredView ? (
                                <div className="mt-2 text-sm text-slate-800 flex items-center justify-between">
                                    <div>
                                        {structuredView.meta.orgLabel}：{structuredView.meta.orgValue || '-'}
                                    </div>
                                    <div>单位：{structuredView.meta.unitValue || '-'}</div>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-500 mt-1">
                                    {activeTable.row_count} 行 × {displayColCount} 列
                                </div>
                            )}
                        </div>

                        {/* 表格渲染 */}
                        {activeTable.data_json && Array.isArray(activeTable.data_json) ? (
                            <div className={`rounded-lg overflow-hidden ${structuredView ? 'border border-slate-700' : 'border border-slate-200'}`}>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        {structuredView ? (
                                            <>
                                                <thead>
                                                    {structuredView.headerRows.map((headerRow, rowIndex) => (
                                                        <tr key={`h-${rowIndex}`} className="bg-slate-100">
                                                            {headerRow.map((cell, cellIndex) => (
                                                                <th
                                                                    key={`h-${rowIndex}-${cellIndex}`}
                                                                    colSpan={cell.colSpan}
                                                                    rowSpan={cell.rowSpan}
                                                                    className="border border-slate-700 px-2.5 py-1.5 text-slate-900 font-semibold text-center"
                                                                >
                                                                    {cell.text}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </thead>
                                                <tbody>
                                                    {structuredView.bodyRows.map((row, rowIndex) => (
                                                        <tr key={`b-${rowIndex}`} className="hover:bg-slate-50">
                                                            {padRow(row, structuredView.colCount).map((cellContent, cellIndex) => {
                                                                const isNumericColumn = structuredView.numericColumns.includes(cellIndex);
                                                                const content = toCellText(cellContent);
                                                                const fillZero = structuredView.fillMissingNumericWithZero !== false;
                                                                return (
                                                                    <td
                                                                        key={`b-${rowIndex}-${cellIndex}`}
                                                                        className={`border border-slate-700 px-2.5 py-1.5 text-slate-700 ${isNumericColumn ? 'text-right' : ''}`}
                                                                    >
                                                                        {content || (isNumericColumn && fillZero ? '0' : '')}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </>
                                        ) : (
                                            <tbody>
                                                {normalizedRows.map((row, rowIndex) => {
                                                    const nonEmptyIndexes = row
                                                        .map((cell, idx) => ({ cell, idx }))
                                                        .filter((item) => item.cell.trim() !== '')
                                                        .map((item) => item.idx);
                                                    const numericIndexes = row
                                                        .map((cell, idx) => ({ cell, idx }))
                                                        .filter((item) => isNumericLike(item.cell))
                                                        .map((item) => item.idx);
                                                    const firstNumericIndex = numericIndexes.length > 0
                                                        ? numericIndexes[0]
                                                        : (!tableHasNumericRows && isSummaryLabel(row[0]) ? 1 : Number.POSITIVE_INFINITY);
                                                    const hasCodeMarker = row.slice(0, 3).some((cell) => /^\d{2,3}$/.test(cell));
                                                    const isDataRow = numericIndexes.length > 0 || hasCodeMarker || (!tableHasNumericRows && isSummaryLabel(row[0]));
                                                    const singleCellHeaderLike = nonEmptyIndexes.length === 1
                                                        && nonEmptyIndexes[0] === 0
                                                        && !isDataRow
                                                        && !isSummaryLabel(row[0]);

                                                    return (
                                                        <tr
                                                            key={rowIndex}
                                                            className={rowIndex === 0 ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'}
                                                        >
                                                            {singleCellHeaderLike ? (
                                                                <td
                                                                    className="border border-slate-200 px-2.5 py-1.5 text-slate-700 font-medium"
                                                                    colSpan={Math.max(normalizedColCount, 1)}
                                                                >
                                                                    {row[0]}
                                                                </td>
                                                            ) : (
                                                                row.map((cellContent, cellIndex) => {
                                                                    const isEmpty = !cellContent.trim();
                                                                    const shouldFillZero = isEmpty
                                                                        && isDataRow
                                                                        && cellIndex >= Math.max(firstNumericIndex, 1);
                                                                    return (
                                                                        <td
                                                                            key={cellIndex}
                                                                            className={`
                                        border border-slate-200 px-2.5 py-1.5 text-slate-700
                                        ${isEmpty ? 'bg-slate-50/50' : ''}
                                        ${rowIndex === 0 ? 'font-semibold text-slate-800' : ''}
                                      `}
                                                                        >
                                                                            {isEmpty ? (
                                                                                shouldFillZero ? (
                                                                                    <span className="text-slate-700">0</span>
                                                                                ) : (
                                                                                    <span className="text-slate-300">—</span>
                                                                                )
                                                                            ) : (
                                                                                cellContent
                                                                            )}
                                                                        </td>
                                                                    );
                                                                })
                                                            )}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        )}
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="p-8 text-center text-slate-400 border border-dashed border-slate-300 rounded-lg">
                                <p>该表格无有效数据</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-8 text-center text-slate-400">
                        <p>请选择一个表格查看</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TableDataViewer;
