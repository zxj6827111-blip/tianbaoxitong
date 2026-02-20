import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../utils/apiClient';
import type { InputFieldKey } from './ManualInputsForm';

interface ManualInput {
  key: string;
  value_text?: string | null;
  value_numeric?: number | null;
}

interface LineItem {
  item_key: string;
  item_label: string;
  amount_current_wanyuan?: number | null;
  amount_prev_wanyuan?: number | null;
  change_ratio?: number | null;
  reason_text?: string | null;
  previous_reason_text?: string | null;
  reason_required: boolean;
  order_no: number;
}

interface DiffItem {
  key: string;
  current_value: number | null;
  previous_value: number | null;
}

interface BudgetExplanationComposerProps {
  draftId: string;
  draftYear: number;
  initialInputs: ManualInput[];
  ifMatchUpdatedAt?: string | null;
  onSaveManualInputs: (inputs: ManualInput[]) => Promise<void>;
  onReuseHistory?: (key: string) => Promise<string | null>;
  onLineItemStatsChange?: (stats: { total: number; required: number; missing: number }) => void;
  onDraftUpdated?: (draft: any) => void;
  onCompletionChange?: (completed: boolean) => void;
  focusRequest?: {
    key: InputFieldKey;
    nonce: number;
  } | null;
  unitName?: string;
}

const DRAFT_LOAD_CACHE_TTL_MS = 10 * 1000;
const DRAFT_AUTO_LOAD_GUARD_MS = 60 * 1000;
const draftLoadCache = new Map<string, { at: number; lineItems: LineItem[]; diffItems: DiffItem[] }>();
const draftInflightMap = new Map<string, Promise<{ lineItems: LineItem[]; diffItems: DiffItem[] }>>();
const draftAutoLoadedAt = new Map<string, number>();

const fetchDraftLoadPayload = async (draftId: string) => {
  const now = Date.now();
  const cached = draftLoadCache.get(draftId);
  if (cached && now - cached.at < DRAFT_LOAD_CACHE_TTL_MS) {
    return { lineItems: cached.lineItems, diffItems: cached.diffItems };
  }

  const inflight = draftInflightMap.get(draftId);
  if (inflight) {
    return inflight;
  }

  const request = Promise.all([
    apiClient.getLineItems(draftId),
    apiClient.getDraftDiffSummary(draftId)
  ]).then(([lineResp, diffResp]) => {
    const lineItems = Array.isArray(lineResp?.items) ? [...lineResp.items] : [];
    lineItems.sort((a, b) => Number(a.order_no || 0) - Number(b.order_no || 0));
    const diffItems = Array.isArray(diffResp?.items) ? diffResp.items : [];
    draftLoadCache.set(draftId, { at: Date.now(), lineItems, diffItems });
    return { lineItems, diffItems };
  }).finally(() => {
    draftInflightMap.delete(draftId);
  });

  draftInflightMap.set(draftId, request);
  return request;
};

const calcStats = (items: LineItem[]) => ({
  total: items.length,
  required: items.filter((item) => item.reason_required).length,
  missing: items.filter((item) => item.reason_required && !(item.reason_text || '').trim()).length
});

const toFiniteOrNull = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toWanFromYuan = (value: number | null) => {
  if (value === null) return null;
  return value / 10000;
};

const formatWan = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const compareText = (current: number | null, previous: number | null, prevYear: number) => {
  if (current === null || previous === null) {
    return '';
  }
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) {
    return `，与${prevYear}年预算持平`;
  }
  const trend = diff > 0 ? '增加' : '减少';
  return `，比${prevYear}年预算${trend}${formatWan(Math.abs(diff))}万元`;
};

const ensureSentence = (text: string) => {
  const clean = text.trim().replace(/[。；;]+$/g, '');
  if (!clean) {
    return '原因待补充。';
  }
  return `${clean}。`;
};

const normalizeUnitName = (raw: string | null | undefined) => {
  if (!raw) return '';
  let text = String(raw).trim();
  text = text.replace(/预算单位[:：]?/, '').trim();
  text = text.replace(/（?单位）?主要职能.*$/, '').trim();
  text = text.replace(/（?部门）?主要职能.*$/, '').trim();
  text = text.replace(/主要职能.*$/, '').trim();
  text = text.replace(/[（(](部门|单位)[）)]$/g, '').trim();
  if (/^\d+$/.test(text)) return '';
  return text;
};

const extractUnitNameFromMainFunctions = (raw: string | null | undefined) => {
  const text = String(raw || '').trim().replace(/\s+/g, '');
  if (!text) return '';
  const matched = text.match(/^([^，。；;：:\n]{4,80}?)(?:是|负责|主要)/);
  return matched?.[1] || '';
};

const buildPreviewLine = (item: LineItem, index: number) => {
  const reasonText = (item.reason_text || '').trim();
  const label = item.item_label || item.item_key;
  const current = Number(item.amount_current_wanyuan ?? 0).toFixed(2);
  const prev = Number(item.amount_prev_wanyuan ?? 0).toFixed(2);

  if (reasonText && reasonText.includes('万元')) {
    return `${index + 1}. ${ensureSentence(reasonText)}`;
  }

  const reasonSnippet = reasonText || '原因待补充';
  return `${index + 1}. “${label}”科目${current}万元，上年:${prev}万元，主要${ensureSentence(reasonSnippet)}`;
};

export const BudgetExplanationComposer: React.FC<BudgetExplanationComposerProps> = ({
  draftId,
  draftYear,
  initialInputs,
  ifMatchUpdatedAt,
  onSaveManualInputs,
  onReuseHistory,
  onLineItemStatsChange,
  onDraftUpdated,
  onCompletionChange,
  focusRequest,
  unitName
}) => {
  const [overviewText, setOverviewText] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [lineItemsLoading, setLineItemsLoading] = useState(true);
  const [lineItemsSaving, setLineItemsSaving] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'needs_reason' | 'missing'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const overviewRef = useRef<HTMLTextAreaElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const onLineItemStatsChangeRef = useRef(onLineItemStatsChange);
  const onDraftUpdatedRef = useRef(onDraftUpdated);
  const onCompletionChangeRef = useRef(onCompletionChange);

  useEffect(() => {
    onLineItemStatsChangeRef.current = onLineItemStatsChange;
  }, [onLineItemStatsChange]);

  useEffect(() => {
    onDraftUpdatedRef.current = onDraftUpdated;
  }, [onDraftUpdated]);

  useEffect(() => {
    onCompletionChangeRef.current = onCompletionChange;
  }, [onCompletionChange]);

  useEffect(() => {
    const overview = initialInputs.find((item) => item.key === 'budget_explanation')?.value_text || '';
    const reason = initialInputs.find((item) => item.key === 'budget_change_reason')?.value_text || '';
    setOverviewText(String(overview));
    setChangeReason(String(reason));
  }, [initialInputs]);

  useEffect(() => {
    onCompletionChangeRef.current?.(changeReason.trim().length > 0);
  }, [changeReason]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    if (focusRequest.key === 'budget_explanation') {
      overviewRef.current?.focus();
    }
    if (focusRequest.key === 'budget_change_reason') {
      reasonRef.current?.focus();
    }
  }, [focusRequest]);

  const loadDraftData = async (force = false) => {
    try {
      setLineItemsLoading(true);
      setErrorMessage(null);
      const now = Date.now();
      const last = draftAutoLoadedAt.get(draftId) || 0;
      if (!force && now - last < DRAFT_AUTO_LOAD_GUARD_MS) {
        const cached = draftLoadCache.get(draftId);
        if (cached) {
          setLineItems(cached.lineItems);
          onLineItemStatsChangeRef.current?.(calcStats(cached.lineItems));
          setDiffItems(cached.diffItems);
          return;
        }
      }

      const payload = await fetchDraftLoadPayload(draftId);
      draftAutoLoadedAt.set(draftId, Date.now());
      const nextItems = payload.lineItems;
      setLineItems(nextItems);
      onLineItemStatsChangeRef.current?.(calcStats(nextItems));
      setDiffItems(payload.diffItems);
    } catch (error) {
      setErrorMessage('加载类款项失败，请刷新后重试');
    } finally {
      setLineItemsLoading(false);
    }
  };

  useEffect(() => {
    void loadDraftData(false);
  }, [draftId]);

  const diffMap = useMemo(() => {
    const map = new Map<string, DiffItem>();
    diffItems.forEach((item) => map.set(item.key, item));
    return map;
  }, [diffItems]);

  const filteredItems = useMemo(() => {
    return lineItems.filter((item) => {
      if (searchTerm && !String(item.item_label || '').toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      if (filter === 'needs_reason') {
        return item.reason_required;
      }
      if (filter === 'missing') {
        return item.reason_required && !(item.reason_text || '').trim();
      }
      return true;
    });
  }, [lineItems, searchTerm, filter]);

  const filterStats = useMemo(() => {
    const total = lineItems.length;
    const needsReason = lineItems.filter((item) => item.reason_required).length;
    const missing = lineItems.filter((item) => item.reason_required && !(item.reason_text || '').trim()).length;
    return { total, needsReason, missing };
  }, [lineItems]);

  const previewText = useMemo(() => {
    const header = overviewText.trim() || '（请先填写或生成总体情况说明）';
    const lines = lineItems.map((item, index) => buildPreviewLine(item, index));
    return `${header}\n\n财政拨款支出主要内容如下：\n${lines.join('\n')}`;
  }, [overviewText, lineItems]);

  // Calculate fiscal trend for label
  const fiscalTrend = useMemo(() => {
    const fiscalExpenditure = diffItems.find(item => item.key === 'fiscal_grant_expenditure_total');
    if (!fiscalExpenditure) return '增加（减少）';

    const current = toFiniteOrNull(fiscalExpenditure.current_value);
    const previous = toFiniteOrNull(fiscalExpenditure.previous_value);
    if (current === null || previous === null) return '增加（减少）';

    const diff = current - previous;

    if (Math.abs(diff) < 0.005) return '增加（减少）';
    return diff > 0 ? '增加' : '减少';
  }, [diffItems]);

  const buildOverviewFromFacts = () => {
    const prevYear = draftYear - 1;
    const revenue = diffMap.get('budget_revenue_total');
    const expenditure = diffMap.get('budget_expenditure_total');
    const fiscalRevenue = diffMap.get('fiscal_grant_revenue_total');
    const fiscalExpenditure = diffMap.get('fiscal_grant_expenditure_total');
    const businessRevenue = diffMap.get('budget_revenue_business');
    const operationRevenue = diffMap.get('budget_revenue_operation');
    const otherRevenue = diffMap.get('budget_revenue_other');
    const fiscalGeneral = diffMap.get('fiscal_grant_expenditure_general');
    const fiscalGovFund = diffMap.get('fiscal_grant_expenditure_gov_fund');
    const fiscalCapital = diffMap.get('fiscal_grant_expenditure_capital');

    const revenueCurrent = toWanFromYuan(toFiniteOrNull(revenue?.current_value));
    const fiscalRevenueCurrent = toWanFromYuan(toFiniteOrNull(fiscalRevenue?.current_value));
    const fiscalRevenuePrev = toWanFromYuan(toFiniteOrNull(fiscalRevenue?.previous_value));

    const businessRevenueCurrent = toWanFromYuan(toFiniteOrNull(businessRevenue?.current_value));
    const operationRevenueCurrent = toWanFromYuan(toFiniteOrNull(operationRevenue?.current_value));
    const otherRevenueCurrent = toWanFromYuan(toFiniteOrNull(otherRevenue?.current_value));

    const expenditureCurrent = toWanFromYuan(toFiniteOrNull(expenditure?.current_value));
    const fiscalExpenditureCurrent = toWanFromYuan(toFiniteOrNull(fiscalExpenditure?.current_value));
    const fiscalExpenditurePrev = toWanFromYuan(toFiniteOrNull(fiscalExpenditure?.previous_value));

    const fiscalGeneralCurrent = toWanFromYuan(toFiniteOrNull(fiscalGeneral?.current_value));
    const fiscalGeneralPrev = toWanFromYuan(toFiniteOrNull(fiscalGeneral?.previous_value));
    const fiscalGovFundCurrent = toWanFromYuan(toFiniteOrNull(fiscalGovFund?.current_value));
    const fiscalGovFundPrev = toWanFromYuan(toFiniteOrNull(fiscalGovFund?.previous_value));
    const fiscalCapitalCurrent = toWanFromYuan(toFiniteOrNull(fiscalCapital?.current_value));
    const fiscalCapitalPrev = toWanFromYuan(toFiniteOrNull(fiscalCapital?.previous_value));

    const manualUnitName = normalizeUnitName(initialInputs.find((item) => item.key === 'unit_full_name')?.value_text || '');
    const fromMainFunctions = normalizeUnitName(extractUnitNameFromMainFunctions(initialInputs.find((item) => item.key === 'main_functions')?.value_text || ''));
    const draftUnitName = normalizeUnitName(unitName || '');
    const name = manualUnitName || fromMainFunctions || draftUnitName || '本单位';

    return `${draftYear}年，${name}收入预算${formatWan(revenueCurrent)}万元，其中：财政拨款收入${formatWan(fiscalRevenueCurrent)}万元${compareText(fiscalRevenueCurrent, fiscalRevenuePrev, prevYear)}；事业收入${formatWan(businessRevenueCurrent)}万元；事业单位经营收入${formatWan(operationRevenueCurrent)}万元；其他收入${formatWan(otherRevenueCurrent)}万元。\n    支出预算${formatWan(expenditureCurrent)}万元，其中：财政拨款支出预算${formatWan(fiscalExpenditureCurrent)}万元${compareText(fiscalExpenditureCurrent, fiscalExpenditurePrev, prevYear)}。财政拨款支出预算中，一般公共预算拨款支出预算${formatWan(fiscalGeneralCurrent)}万元${compareText(fiscalGeneralCurrent, fiscalGeneralPrev, prevYear)}；政府性基金拨款支出预算${formatWan(fiscalGovFundCurrent)}万元${compareText(fiscalGovFundCurrent, fiscalGovFundPrev, prevYear)}；国有资本经营预算拨款支出预算${formatWan(fiscalCapitalCurrent)}万元${compareText(fiscalCapitalCurrent, fiscalCapitalPrev, prevYear)}。`;
  };

  const handleGenerateOverview = () => {
    setOverviewText(buildOverviewFromFacts());
    setStatusMessage('已按预算汇总数据生成总体说明，可继续微调。');
    setErrorMessage(null);
  };

  const handleFillHistory = async (key: 'budget_explanation' | 'budget_change_reason') => {
    if (!onReuseHistory) {
      return;
    }
    const text = await onReuseHistory(key);
    if (!text) {
      return;
    }
    if (key === 'budget_explanation') {
      setOverviewText(text);
    } else {
      setChangeReason(text);
    }
  };

  const handleSaveManual = async () => {
    try {
      setManualSaving(true);
      setErrorMessage(null);
      await onSaveManualInputs([
        { key: 'budget_explanation', value_text: overviewText },
        { key: 'budget_change_reason', value_text: changeReason }
      ]);
      setStatusMessage('总体说明已保存。');
    } catch (error) {
      setErrorMessage('保存总体说明失败，请稍后重试');
    } finally {
      setManualSaving(false);
    }
  };

  const updateLineItemsState = (updater: (items: LineItem[]) => LineItem[]) => {
    setLineItems((prev) => {
      const next = updater(prev);
      onLineItemStatsChangeRef.current?.(calcStats(next));
      return next;
    });
  };

  const handleReusePrevForEmpty = () => {
    let applied = 0;
    updateLineItemsState((items) => items.map((item) => {
      if ((item.reason_text || '').trim()) {
        return item;
      }
      const prev = (item.previous_reason_text || '').trim();
      if (!prev) {
        return item;
      }
      applied += 1;
      return { ...item, reason_text: prev };
    }));
    setStatusMessage(applied > 0 ? `已批量复用 ${applied} 条去年用途说明。` : '没有可复用的去年用途说明。');
  };

  const handleSaveLineItems = async () => {
    try {
      setLineItemsSaving(true);
      setErrorMessage(null);
      const payload = lineItems.map((item) => ({
        item_key: item.item_key,
        reason_text: item.reason_text || null,
        order_no: item.order_no
      }));
      const response = await apiClient.updateLineItems(draftId, {
        items: payload,
        if_match_updated_at: ifMatchUpdatedAt || undefined
      });
      if (Array.isArray(response?.items)) {
        const nextItems = [...response.items];
        nextItems.sort((a, b) => Number(a.order_no || 0) - Number(b.order_no || 0));
        setLineItems(nextItems);
        onLineItemStatsChangeRef.current?.(calcStats(nextItems));
        draftLoadCache.set(draftId, {
          at: Date.now(),
          lineItems: nextItems,
          diffItems
        });
      }
      if (response?.draft) {
        onDraftUpdatedRef.current?.(response.draft);
      }
      setStatusMessage('类款项用途说明已保存。');
    } catch (error: any) {
      const code = error?.response?.data?.code;
      if (code === 'STALE_DRAFT') {
        setErrorMessage('草稿已被更新，请刷新后重试');
      } else {
        setErrorMessage('保存类款项说明失败，请稍后重试');
      }
    } finally {
      setLineItemsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">A. 总体情况说明（自动生成 + 可编辑）</h3>
            <p className="text-xs text-slate-500 mt-1">数字来自本草稿预算汇总，重点只需要补充“增减原因”。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleFillHistory('budget_explanation')}
              className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              引用去年的总体说明
            </button>
            <button
              type="button"
              onClick={handleGenerateOverview}
              className="px-3 py-1.5 text-xs rounded bg-brand-600 text-white hover:bg-brand-700"
            >
              一键生成总体说明
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">预算编制说明</label>
          <textarea
            ref={overviewRef}
            value={overviewText}
            onChange={(e) => setOverviewText(e.target.value)}
            rows={7}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-700">财政拨款收入支出{fiscalTrend}的主要原因是</label>
            <button
              type="button"
              onClick={() => void handleFillHistory('budget_change_reason')}
              className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              引用去年原因
            </button>
          </div>
          <textarea
            ref={reasonRef}
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            placeholder="例如：项目安排调整、人员结构变化、一次性支出减少等。"
          />
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => void handleSaveManual()}
            disabled={manualSaving}
            className="px-5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            {manualSaving ? '保存中...' : '保存总体说明'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">B. 财政拨款支出主要内容（自动抽取类款项）</h3>
            <p className="text-xs text-slate-500 mt-1">来源：预算表自动抽取。你只需补“主要用于...”。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadDraftData(true)}
              className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              刷新类款项
            </button>
            <button
              type="button"
              onClick={handleReusePrevForEmpty}
              className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              批量复用去年（空白项）
            </button>
            <button
              type="button"
              onClick={() => void handleSaveLineItems()}
              disabled={lineItemsSaving}
              className="px-3 py-1.5 text-xs rounded bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300"
            >
              {lineItemsSaving ? '保存中...' : '保存类款项说明'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="按科目名称搜索"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'needs_reason' | 'missing')}
            className="px-3 py-2 border border-slate-300 rounded-lg"
          >
            <option value="all">查看全部</option>
            <option value="needs_reason">仅看需填</option>
            <option value="missing">仅看未填</option>
          </select>
        </div>
        <div className="text-xs text-slate-500">
          共 {filterStats.total} 条，需填 {filterStats.needsReason} 条，未填 {filterStats.missing} 条
        </div>

        {lineItemsLoading ? (
          <div className="text-sm text-slate-500 py-4">类款项加载中...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 space-y-2">
            <div>当前筛选条件下没有条目。</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                切换为查看全部
              </button>
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                清空搜索
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {filteredItems.map((item) => (
              <div
                key={item.item_key}
                className={`rounded-lg border p-3 ${item.reason_required && !(item.reason_text || '').trim() ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.item_label}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      本年: {formatWan(item.amount_current_wanyuan)} 万元 | 上年: {formatWan(item.amount_prev_wanyuan)} 万元
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const prev = (item.previous_reason_text || '').trim();
                      if (!prev) {
                        return;
                      }
                      updateLineItemsState((items) => items.map((row) => (
                        row.item_key === item.item_key ? { ...row, reason_text: prev } : row
                      )));
                    }}
                    className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                  >
                    复用去年
                  </button>
                </div>
                {item.previous_reason_text ? (
                  <div className="mt-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                    去年用途：{item.previous_reason_text}
                  </div>
                ) : null}
                <textarea
                  value={item.reason_text || ''}
                  onChange={(e) => {
                    const nextText = e.target.value;
                    updateLineItemsState((items) => items.map((row) => (
                      row.item_key === item.item_key ? { ...row, reason_text: nextText } : row
                    )));
                  }}
                  rows={2}
                  className="mt-2 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  placeholder={item.reason_required ? '请填写该科目用途说明（如：主要用于...）' : '可选填写用途说明'}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-900">实时成稿预览（第4节 + 类款项）</h3>
        <textarea
          readOnly
          value={previewText}
          rows={14}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-slate-50"
        />
      </div>

      {(statusMessage || errorMessage) && (
        <div className={`rounded-lg px-4 py-3 text-sm ${errorMessage ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {errorMessage || statusMessage}
        </div>
      )}
    </div>
  );
};
