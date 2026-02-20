
import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/apiClient';
import { buildStructuredView, inferTableKey, StructuredTableView } from './BudgetTableLogic';

interface BudgetTableMeta {
  key: string;
  title: string;
  sheet_name: string | null;
  status: 'READY' | 'MISSING' | string;
  row_count: number;
  col_count: number;
}

interface BudgetTableDetail extends BudgetTableMeta {
  rows: string[][];
}

interface DiagnosisItem {
  key: string;
  title: string;
  status: string;
  matched_sheet_name: string | null;
  expected_sheet_hints: string[];
  candidates: Array<{
    sheet_name: string;
    score: number;
    matched_keywords: string[];
  }>;
}

interface DiagnosisPayload {
  summary: {
    total: number;
    ready: number;
    missing: number;
  };
  diagnostics: DiagnosisItem[];
  suggestions: string[];
}

interface BudgetTablesViewerProps {
  draftId: string;
  onStatusChange?: (status: { loaded: boolean; total: number; ready: number; missing: number }) => void;
}

const statusClass = (status: string) => {
  if (status === 'READY') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  return 'bg-amber-50 text-amber-700 border-amber-200';
};

// Simplified column width mapping based on table type
const getColWidths = (key: string, colCount: number): string[] => {
  if (['income_summary', 'expenditure_summary', 'general_budget', 'gov_fund_budget', 'capital_budget'].includes(key)) {
    // Standard code table: 3 codes + 1 name + nums
    return ['w-12', 'w-12', 'w-12', 'min-w-[240px]', ...Array(colCount - 4).fill('w-28')];
  }
  if (key === 'basic_expenditure') {
    // 2 codes + 1 name + nums
    return ['w-12', 'w-12', 'min-w-[240px]', ...Array(colCount - 3).fill('w-28')];
  }
  if (key === 'fiscal_grant_summary') {
    // Complex mixed content
    return ['min-w-[180px]', 'w-24', 'min-w-[180px]', 'w-24', 'w-24', 'w-24', 'w-24'];
  }
  if (key === 'budget_summary') {
    // 4 cols: Item, Budget, Item, Budget
    return ['min-w-[180px]', 'w-32', 'min-w-[180px]', 'w-32'];
  }
  if (key === 'three_public') {
    // 7 cols
    return ['min-w-[120px]', 'w-24', 'w-24', 'w-24', 'w-24', 'w-24', 'w-24'];
  }
  return Array(colCount).fill('auto'); // Fallback
};

export const BudgetTablesViewer: React.FC<BudgetTablesViewerProps> = ({ draftId, onStatusChange }) => {
  const [tables, setTables] = useState<BudgetTableMeta[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<BudgetTableDetail | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = tables.length;
    const ready = tables.filter((item) => item.status === 'READY').length;
    const missing = tables.filter((item) => item.status !== 'READY').length;
    return { total, ready, missing };
  }, [tables]);

  useEffect(() => {
    onStatusChange?.({
      loaded: !loadingMeta,
      total: stats.total,
      ready: stats.ready,
      missing: stats.missing
    });
  }, [loadingMeta, stats.total, stats.ready, stats.missing, onStatusChange]);

  useEffect(() => {
    let mounted = true;
    const loadMeta = async () => {
      try {
        setLoadingMeta(true);
        setError(null);
        const response = await apiClient.listBudgetTables(draftId);
        if (!mounted) {
          return;
        }
        const nextTables = Array.isArray(response?.tables) ? response.tables : [];
        setTables(nextTables);
        setDiagnosis(null);
        const firstReady = nextTables.find((item: BudgetTableMeta) => item.status === 'READY');
        const fallback = nextTables[0];
        const nextKey = firstReady?.key || fallback?.key || '';
        setSelectedKey(nextKey);
      } catch (e) {
        if (mounted) {
          setError('预算表目录加载失败，请重试');
        }
      } finally {
        if (mounted) {
          setLoadingMeta(false);
        }
      }
    };
    void loadMeta();
    return () => {
      mounted = false;
    };
  }, [draftId]);

  const handleDiagnose = async () => {
    try {
      setDiagnosing(true);
      setError(null);
      const response = await apiClient.diagnoseBudgetTables(draftId);
      setDiagnosis({
        summary: response?.summary || { total: 0, ready: 0, missing: 0 },
        diagnostics: Array.isArray(response?.diagnostics) ? response.diagnostics : [],
        suggestions: Array.isArray(response?.suggestions) ? response.suggestions : []
      });
    } catch (e) {
      setError('缺失表诊断失败，请稍后重试');
    } finally {
      setDiagnosing(false);
    }
  };

  useEffect(() => {
    if (!selectedKey) {
      setSelectedTable(null);
      return;
    }

    let mounted = true;
    const loadDetail = async () => {
      try {
        setLoadingDetail(true);
        setError(null);
        const response = await apiClient.getBudgetTable(draftId, selectedKey);
        if (!mounted) {
          return;
        }
        setSelectedTable(response?.table || null);
      } catch (e) {
        if (mounted) {
          setError('预算表明细加载失败，请重试');
        }
      } finally {
        if (mounted) {
          setLoadingDetail(false);
        }
      }
    };
    void loadDetail();
    return () => {
      mounted = false;
    };
  }, [draftId, selectedKey]);

  // Main Rendering Logic
  const { view, displayRows, colWidths, isStructured } = useMemo(() => {
    if (!selectedTable) return { view: null, displayRows: [], colWidths: [], isStructured: false };

    // 1. Try to build a structured view using robust logic
    const inferredKey = inferTableKey(selectedTable.title);
    const structured = buildStructuredView(inferredKey, selectedTable.rows);

    if (structured) {
      return {
        view: structured,
        displayRows: structured.bodyRows,
        colWidths: getColWidths(inferredKey, structured.colCount),
        isStructured: true
      };
    }

    // 2. Fallback to generic simple view
    return {
      view: null,
      displayRows: selectedTable.rows.slice(0, 100), // Safety limit for raw fallback
      colWidths: Array(selectedTable.col_count).fill('auto'),
      isStructured: false
    };
  }, [selectedTable]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div>预算表目录共 {stats.total || 9} 张，已识别 {stats.ready} 张，缺失 {stats.missing} 张。</div>
            <div className="mt-1">第5部分只用于核对预算表，不在此填写“财政拨款支出主要内容”。</div>
          </div>
          <button
            type="button"
            onClick={() => void handleDiagnose()}
            disabled={diagnosing}
            className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-white disabled:bg-slate-200"
          >
            {diagnosing ? '诊断中...' : '一键诊断缺失表'}
          </button>
        </div>
      </div>

      {diagnosis ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
          <div className="text-sm font-semibold text-slate-800">
            诊断结果：已识别 {diagnosis.summary.ready}/{diagnosis.summary.total}，缺失 {diagnosis.summary.missing} 张
          </div>
          {diagnosis.suggestions.length > 0 ? (
            <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1">
              {diagnosis.suggestions.map((tip, idx) => (
                <li key={`tip-${idx}`}>{tip}</li>
              ))}
            </ul>
          ) : null}
          {diagnosis.diagnostics.filter((item) => item.status !== 'READY').length > 0 ? (
            <div className="space-y-2">
              {diagnosis.diagnostics.filter((item) => item.status !== 'READY').map((item) => (
                <div key={`diag-${item.key}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="text-sm font-medium text-amber-800">{item.title}</div>
                  <div className="text-xs text-amber-700 mt-1">
                    建议工作表名：{item.expected_sheet_hints.join(' / ')}
                  </div>
                  {item.candidates.length > 0 ? (
                    <div className="text-xs text-amber-700 mt-1">
                      可能对应：{item.candidates.map((c) => `${c.sheet_name}（匹配: ${c.matched_keywords.join('、')}）`).join('；')}
                    </div>
                  ) : (
                    <div className="text-xs text-amber-700 mt-1">
                      未找到相近工作表，请检查模板是否缺表。
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              当前9张预算表均已识别，无需处理。
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <aside className="xl:col-span-1 border-r border-slate-200 bg-white p-3 space-y-2 lg:border lg:rounded-lg">
          <div className="text-sm font-semibold text-slate-800 px-1">预算表目录</div>
          {loadingMeta ? (
            <div className="text-sm text-slate-500 px-1 py-2">目录加载中...</div>
          ) : tables.length === 0 ? (
            <div className="text-sm text-slate-500 px-1 py-2">未识别到预算表目录。</div>
          ) : (
            tables.map((table) => {
              const active = selectedKey === table.key;
              return (
                <button
                  key={table.key}
                  type="button"
                  onClick={() => setSelectedKey(table.key)}
                  className={`w-full text-left rounded-md border px-2.5 py-2 transition-colors ${active ? 'border-brand-500 bg-brand-50 shadow-sm ring-1 ring-brand-200' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <div className={`text-sm ${active ? 'font-medium text-brand-700' : 'text-slate-700'}`}>{table.title}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${statusClass(table.status)}`}>
                      {table.status === 'READY' ? '已识别' : '缺失'}
                    </span>
                    <span className="text-slate-500">{table.row_count} x {table.col_count}</span>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="xl:col-span-3 rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          {loadingDetail ? (
            <div className="text-sm text-slate-500 py-16 text-center flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-300 border-t-brand-500"></div>
              <div>预算表加载中...</div>
            </div>
          ) : !selectedTable ? (
            <div className="text-sm text-slate-500 py-16 text-center">请选择左侧预算表查看。</div>
          ) : selectedTable.status !== 'READY' ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-3">
              当前文件中未识别到该预算表，请确认上传模板是否完整。
            </div>
          ) : (
            <>
              {/* Report Header Section */}
              <div className="flex flex-col items-center gap-4 pb-4">
                <div className="text-center w-full">
                  <div className="text-xl font-bold text-slate-900 tracking-wide">{selectedTable.title}</div>
                </div>

                {/* Information Bar - Dept Name and Unit */}
                <div className="w-full flex items-center justify-between text-sm font-medium text-slate-700 px-1">
                  <div>{view?.meta.orgLabel || '编制部门'}：{view?.meta.orgValue || '-'}</div>
                  <div>单位：{view?.meta.unitValue || '元'}</div>
                </div>
              </div>

              {/* Enhanced Table Display */}
              <div className="overflow-auto rounded-sm border border-slate-700 shadow-sm max-h-[700px] bg-white">
                <table className="min-w-full text-xs text-slate-800 border-collapse">
                  {/* Column Grouping for widths */}
                  <colgroup>
                    {colWidths.length > 0 ? (
                      colWidths.map((w, idx) => <col key={idx} className={w} />)
                    ) : (
                      Array.from({ length: selectedTable.col_count }).map((_, idx) => <col key={idx} className="auto" />)
                    )}
                  </colgroup>

                  {/* Render Structured Header */}
                  {isStructured && view ? (
                    <thead>
                      {view.headerRows.map((headerRow, rowIndex) => (
                        <tr key={`h-${rowIndex}`} className="bg-slate-50">
                          {headerRow.map((cell, cellIndex) => (
                            <th
                              key={`h-${rowIndex}-${cellIndex}`}
                              colSpan={cell.colSpan}
                              rowSpan={cell.rowSpan}
                              className="border border-slate-700 px-2.5 py-2 text-slate-900 font-semibold text-center align-middle"
                            >
                              {cell.text}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                  ) : null}

                  <tbody>
                    {displayRows.map((row, rowIndex) => {
                      return (
                        <tr key={`r-${rowIndex}`} className="hover:bg-slate-50 border-b border-slate-200">
                          {row.map((cellValue, colIndex) => {
                            // Check if cell is numeric using view info if available
                            const isNumeric = isStructured && view ? view.numericColumns.includes(colIndex) : /^-?[\d,]+(\.\d+)?%?$/.test(cellValue) && cellValue.trim().length > 0;

                            return (
                              <td
                                key={`c-${rowIndex}-${colIndex}`}
                                className={`border border-slate-700 px-3 py-2 align-middle whitespace-nowrap ${isNumeric ? 'text-right font-mono' : 'text-left'}`}
                              >
                                {cellValue}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {displayRows.length === 0 && (
                      <tr>
                        <td colSpan={selectedTable.col_count} className="p-8 text-center text-slate-400">
                          表格数据为空或已被全部过滤
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
