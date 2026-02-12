import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../utils/apiClient';
import type { InputFieldKey } from './ManualInputsForm';

interface ManualInput {
  key: string;
  value_text?: string | null;
  value_numeric?: number | null;
}

interface OtherRelatedComposerProps {
  draftId: string;
  draftYear: number;
  initialInputs: ManualInput[];
  onSaveManualInputs: (inputs: ManualInput[]) => Promise<void>;
  onCompletionChange?: (completed: boolean) => void;
  focusRequest?: {
    key: InputFieldKey;
    nonce: number;
  } | null;
}

type FormState = {
  unit_name: string;
  three_public_total: string;
  three_public_total_prev: string;
  outbound_fee: string;
  outbound_fee_prev: string;
  outbound_reason: string;
  vehicle_total_fee: string;
  vehicle_total_fee_prev: string;
  vehicle_total_reason: string;
  vehicle_purchase_fee: string;
  vehicle_purchase_fee_prev: string;
  vehicle_purchase_reason: string;
  vehicle_operation_fee: string;
  vehicle_operation_fee_prev: string;
  vehicle_operation_reason: string;
  reception_fee: string;
  reception_fee_prev: string;
  reception_reason: string;
  operation_fund: string;
  operation_fund_prev: string;
  operation_org_count: string;
  operation_ref_org_count: string;
  operation_no_fund: boolean;
  procurement_total: string;
  procurement_goods: string;
  procurement_project: string;
  procurement_service: string;
  procurement_reserved_sme: string;
  procurement_reserved_micro: string;
  procurement_no_budget: boolean;
  procurement_notes: string;
  performance_unit_count: string;
  performance_project_count: string;
  performance_budget: string;
  performance_notes: string;
  state_owned_assets: string;
  asset_total: string;
  asset_vehicle_total: string;
  asset_device_over_million: string;
  asset_purchase_vehicle_count: string;
  asset_purchase_device_over_million: string;
  asset_notes: string;
};

type StringFieldKey = {
  [K in keyof FormState]: FormState[K] extends string ? K : never;
}[keyof FormState];

const toText = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const parseBool = (value: unknown) => ['1', 'true', 'yes', 'y'].includes(String(value || '').toLowerCase());

const formatAmount = (value: string) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 'XXX';
  }
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const toDeltaText = (currentRaw: string, previousRaw: string, prevYear: number) => {
  const current = Number(currentRaw);
  const previous = Number(previousRaw);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return `比${prevYear}年预算增加（减少）XXX万元（持平）`;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 0.0001) {
    return `比${prevYear}年预算持平`;
  }
  const verb = diff > 0 ? '增加' : '减少';
  return `比${prevYear}年预算${verb}${formatAmount(String(Math.abs(diff)))}万元`;
};

const ensureReason = (value: string) => {
  const text = value.trim();
  return text ? text : '……';
};

const createInitialState = (initialInputs: ManualInput[]): FormState => {
  const map = new Map(initialInputs.map((item) => [item.key, item]));
  const readText = (key: string) => toText(map.get(key)?.value_text);
  const readNumeric = (key: string) => {
    const input = map.get(key);
    if (!input) return '';
    if (input.value_numeric !== null && input.value_numeric !== undefined) {
      return String(input.value_numeric);
    }
    return toText(input.value_text);
  };

  return {
    unit_name: readText('unit_full_name'),
    three_public_total: readNumeric('other_three_public_total'),
    three_public_total_prev: readNumeric('other_three_public_total_prev'),
    outbound_fee: readNumeric('other_outbound_fee'),
    outbound_fee_prev: readNumeric('other_outbound_fee_prev'),
    outbound_reason: readText('other_outbound_reason'),
    vehicle_total_fee: readNumeric('other_vehicle_total_fee'),
    vehicle_total_fee_prev: readNumeric('other_vehicle_total_fee_prev'),
    vehicle_total_reason: readText('other_vehicle_total_reason'),
    vehicle_purchase_fee: readNumeric('other_vehicle_purchase_fee'),
    vehicle_purchase_fee_prev: readNumeric('other_vehicle_purchase_fee_prev'),
    vehicle_purchase_reason: readText('other_vehicle_purchase_reason'),
    vehicle_operation_fee: readNumeric('other_vehicle_operation_fee'),
    vehicle_operation_fee_prev: readNumeric('other_vehicle_operation_fee_prev'),
    vehicle_operation_reason: readText('other_vehicle_operation_reason'),
    reception_fee: readNumeric('other_reception_fee'),
    reception_fee_prev: readNumeric('other_reception_fee_prev'),
    reception_reason: readText('other_reception_reason'),
    operation_fund: readNumeric('other_operation_fund'),
    operation_fund_prev: readNumeric('other_operation_fund_prev'),
    operation_org_count: readNumeric('other_operation_org_count'),
    operation_ref_org_count: readNumeric('other_operation_ref_org_count'),
    operation_no_fund: parseBool(readText('other_operation_no_fund')),
    procurement_total: readNumeric('procurement_amount'),
    procurement_goods: readNumeric('other_procurement_goods'),
    procurement_project: readNumeric('other_procurement_project'),
    procurement_service: readNumeric('other_procurement_service'),
    procurement_reserved_sme: readNumeric('other_procurement_reserved_sme'),
    procurement_reserved_micro: readNumeric('other_procurement_reserved_micro'),
    procurement_no_budget: parseBool(readText('other_procurement_no_budget')),
    procurement_notes: readText('procurement_notes'),
    performance_unit_count: readNumeric('other_performance_unit_count'),
    performance_project_count: readNumeric('other_performance_project_count'),
    performance_budget: readNumeric('other_performance_budget'),
    performance_notes: readText('other_performance_notes'),
    state_owned_assets: readText('state_owned_assets'),
    asset_total: readNumeric('asset_total'),
    asset_vehicle_total: readNumeric('other_asset_vehicle_total'),
    asset_device_over_million: readNumeric('other_asset_device_over_million'),
    asset_purchase_vehicle_count: readNumeric('other_asset_purchase_vehicle_count'),
    asset_purchase_device_over_million: readNumeric('other_asset_purchase_device_over_million'),
    asset_notes: readText('asset_notes')
  };
};

const buildAssetsSection = (state: FormState, year: number) => {
  const prevYear = year - 1;
  const unitName = state.unit_name.trim() || '本部门';
  return [
    '五、国有资产占有使用情况',
    `截至${prevYear}年8月31日，${unitName}共有车辆${state.asset_vehicle_total || 'XX'}辆；单价100万元（含）以上设备（不含车辆）${state.asset_device_over_million || 'XX'}台（套）。`,
    `${year}年部门预算安排购置车辆${state.asset_purchase_vehicle_count || 'XX'}辆；部门预算安排购置单价100万元（含）以上设备（不含车辆）${state.asset_purchase_device_over_million || 'XX'}台（套）。`,
    state.asset_notes.trim() ? `补充说明：${state.asset_notes.trim()}` : ''
  ].filter(Boolean).join('\n');
};

const buildOtherNotes = (state: FormState, year: number) => {
  const prevYear = year - 1;
  const unitName = state.unit_name.trim() || '本部门';

  const part1 = [
    `一、${year}年“三公”经费预算情况说明`,
    `${year}年“三公”经费预算数为${formatAmount(state.three_public_total)}万元，${toDeltaText(state.three_public_total, state.three_public_total_prev, prevYear)}。其中：`,
    `（一）因公出国（境）费${formatAmount(state.outbound_fee)}万元，${toDeltaText(state.outbound_fee, state.outbound_fee_prev, prevYear)}，主要原因是${ensureReason(state.outbound_reason)}。`,
    `（二）公务用车购置及运行费${formatAmount(state.vehicle_total_fee)}万元，${toDeltaText(state.vehicle_total_fee, state.vehicle_total_fee_prev, prevYear)}，主要原因是${ensureReason(state.vehicle_total_reason)}。其中：公务用车购置费${formatAmount(state.vehicle_purchase_fee)}万元，${toDeltaText(state.vehicle_purchase_fee, state.vehicle_purchase_fee_prev, prevYear)}，主要原因是${ensureReason(state.vehicle_purchase_reason)}；公务用车运行费${formatAmount(state.vehicle_operation_fee)}万元，${toDeltaText(state.vehicle_operation_fee, state.vehicle_operation_fee_prev, prevYear)}，主要原因是${ensureReason(state.vehicle_operation_reason)}。`,
    `（三）公务接待费${formatAmount(state.reception_fee)}万元，${toDeltaText(state.reception_fee, state.reception_fee_prev, prevYear)}，主要原因是${ensureReason(state.reception_reason)}。`
  ].join('\n');

  const part2 = state.operation_no_fund
    ? `二、机关运行经费预算\n本部门无机关运行经费。`
    : [
        '二、机关运行经费预算',
        `${year}年${unitName}下属${state.operation_org_count || 'X'}家机关和${state.operation_ref_org_count || 'X'}家参公事业单位财政拨款的机关运行经费预算为${formatAmount(state.operation_fund)}万元，${toDeltaText(state.operation_fund, state.operation_fund_prev, prevYear)}。`
      ].join('\n');

  const part3 = state.procurement_no_budget
    ? `三、政府采购预算情况\n${unitName}${year}年未安排政府采购预算。`
    : [
        '三、政府采购预算情况',
        `${year}年本部门政府采购预算${formatAmount(state.procurement_total)}万元，其中：政府采购货物预算${formatAmount(state.procurement_goods)}万元、政府采购工程预算${formatAmount(state.procurement_project)}万元、政府采购服务预算${formatAmount(state.procurement_service)}万元。`,
        `${year}年本部门面向中小企业预留政府采购项目预算金额${formatAmount(state.procurement_reserved_sme)}万元，其中，预留给小型和微型企业的政府采购项目预算为${formatAmount(state.procurement_reserved_micro)}万元。`,
        state.procurement_notes.trim() ? `补充说明：${state.procurement_notes.trim()}` : ''
      ].filter(Boolean).join('\n');

  const part4 = [
    '四、绩效目标设置情况',
    `按照本区预算绩效管理工作的总体要求，本部门${state.performance_unit_count || 'X'}个预算单位开展了${year}年项目预算绩效目标编报工作，编报绩效目标的项目${state.performance_project_count || 'X'}个，涉及项目预算资金${formatAmount(state.performance_budget)}万元。${state.performance_notes.trim() || '（绩效目标管理工作情况，以及编报绩效目标的项目数量、单位数量、预算金额等）'}`
  ].join('\n');

  const part5 = state.state_owned_assets.trim() || buildAssetsSection(state, year);

  return [part1, part2, part3, part4, part5].join('\n\n');
};

const asNumericOrNull = (value: string) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const OtherRelatedComposer: React.FC<OtherRelatedComposerProps> = ({
  draftId,
  draftYear,
  initialInputs,
  onSaveManualInputs,
  onCompletionChange,
  focusRequest
}) => {
  const [form, setForm] = useState<FormState>(() => createInitialState(initialInputs));
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailableTips, setUnavailableTips] = useState<Array<{ key: string; label: string; reason: string }>>([]);

  const stateAssetsRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setForm(createInitialState(initialInputs));
  }, [initialInputs]);

  useEffect(() => {
    const completed = form.state_owned_assets.trim().length > 0
      || form.procurement_total.trim().length > 0
      || form.procurement_notes.trim().length > 0
      || form.asset_total.trim().length > 0
      || form.asset_notes.trim().length > 0;
    onCompletionChange?.(completed);
  }, [form.state_owned_assets, form.procurement_total, form.procurement_notes, form.asset_total, form.asset_notes, onCompletionChange]);

  useEffect(() => {
    if (focusRequest?.key === 'state_owned_assets') {
      stateAssetsRef.current?.focus();
    }
  }, [focusRequest]);

  const previewText = useMemo(() => buildOtherNotes(form, draftYear), [form, draftYear]);

  const fillAutoValues = async () => {
    try {
      setLoadingAuto(true);
      setError(null);
      const response = await apiClient.getOtherRelatedAuto(draftId);
      const autoValues = response?.auto_values || {};
      setUnavailableTips(Array.isArray(response?.unavailable_fields) ? response.unavailable_fields : []);

      setForm((prev) => {
        const next = { ...prev };
        const assignIfEmpty = (field: StringFieldKey, value: unknown) => {
          if (next[field].trim().length === 0 && value !== null && value !== undefined) {
            next[field] = String(value);
          }
        };

        assignIfEmpty('three_public_total', autoValues?.three_public_total?.current);
        assignIfEmpty('three_public_total_prev', autoValues?.three_public_total?.previous);
        assignIfEmpty('outbound_fee', autoValues?.three_public_outbound?.current);
        assignIfEmpty('outbound_fee_prev', autoValues?.three_public_outbound?.previous);
        assignIfEmpty('vehicle_total_fee', autoValues?.three_public_vehicle_total?.current);
        assignIfEmpty('vehicle_total_fee_prev', autoValues?.three_public_vehicle_total?.previous);
        assignIfEmpty('vehicle_purchase_fee', autoValues?.three_public_vehicle_purchase?.current);
        assignIfEmpty('vehicle_purchase_fee_prev', autoValues?.three_public_vehicle_purchase?.previous);
        assignIfEmpty('vehicle_operation_fee', autoValues?.three_public_vehicle_operation?.current);
        assignIfEmpty('vehicle_operation_fee_prev', autoValues?.three_public_vehicle_operation?.previous);
        assignIfEmpty('reception_fee', autoValues?.three_public_reception?.current);
        assignIfEmpty('reception_fee_prev', autoValues?.three_public_reception?.previous);
        assignIfEmpty('operation_fund', autoValues?.operation_fund?.current);
        assignIfEmpty('operation_fund_prev', autoValues?.operation_fund?.previous);
        assignIfEmpty('procurement_total', autoValues?.procurement_total?.current);
        assignIfEmpty('asset_total', autoValues?.asset_total?.current);
        return next;
      });

      const coverage = response?.coverage;
      if (coverage) {
        setAutoMessage(`已自动提取 ${coverage.extracted_fields}/${coverage.total_fields} 个字段，未提取项请手动填写。`);
      } else {
        setAutoMessage('已完成自动提取，请检查字段。');
      }
    } catch (e) {
      setError('自动提取失败，请稍后重试');
    } finally {
      setLoadingAuto(false);
    }
  };

  useEffect(() => {
    void fillAutoValues();
  }, [draftId]);

  const update = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value as never }));
  };

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const payload: ManualInput[] = [
        { key: 'unit_full_name', value_text: form.unit_name || null },
        { key: 'other_three_public_total', value_numeric: asNumericOrNull(form.three_public_total) },
        { key: 'other_three_public_total_prev', value_numeric: asNumericOrNull(form.three_public_total_prev) },
        { key: 'other_outbound_fee', value_numeric: asNumericOrNull(form.outbound_fee) },
        { key: 'other_outbound_fee_prev', value_numeric: asNumericOrNull(form.outbound_fee_prev) },
        { key: 'other_outbound_reason', value_text: form.outbound_reason || null },
        { key: 'other_vehicle_total_fee', value_numeric: asNumericOrNull(form.vehicle_total_fee) },
        { key: 'other_vehicle_total_fee_prev', value_numeric: asNumericOrNull(form.vehicle_total_fee_prev) },
        { key: 'other_vehicle_total_reason', value_text: form.vehicle_total_reason || null },
        { key: 'other_vehicle_purchase_fee', value_numeric: asNumericOrNull(form.vehicle_purchase_fee) },
        { key: 'other_vehicle_purchase_fee_prev', value_numeric: asNumericOrNull(form.vehicle_purchase_fee_prev) },
        { key: 'other_vehicle_purchase_reason', value_text: form.vehicle_purchase_reason || null },
        { key: 'other_vehicle_operation_fee', value_numeric: asNumericOrNull(form.vehicle_operation_fee) },
        { key: 'other_vehicle_operation_fee_prev', value_numeric: asNumericOrNull(form.vehicle_operation_fee_prev) },
        { key: 'other_vehicle_operation_reason', value_text: form.vehicle_operation_reason || null },
        { key: 'other_reception_fee', value_numeric: asNumericOrNull(form.reception_fee) },
        { key: 'other_reception_fee_prev', value_numeric: asNumericOrNull(form.reception_fee_prev) },
        { key: 'other_reception_reason', value_text: form.reception_reason || null },
        { key: 'other_operation_fund', value_numeric: asNumericOrNull(form.operation_fund) },
        { key: 'other_operation_fund_prev', value_numeric: asNumericOrNull(form.operation_fund_prev) },
        { key: 'other_operation_org_count', value_numeric: asNumericOrNull(form.operation_org_count) },
        { key: 'other_operation_ref_org_count', value_numeric: asNumericOrNull(form.operation_ref_org_count) },
        { key: 'other_operation_no_fund', value_text: form.operation_no_fund ? '1' : '0' },
        { key: 'procurement_amount', value_numeric: asNumericOrNull(form.procurement_total) },
        { key: 'other_procurement_goods', value_numeric: asNumericOrNull(form.procurement_goods) },
        { key: 'other_procurement_project', value_numeric: asNumericOrNull(form.procurement_project) },
        { key: 'other_procurement_service', value_numeric: asNumericOrNull(form.procurement_service) },
        { key: 'other_procurement_reserved_sme', value_numeric: asNumericOrNull(form.procurement_reserved_sme) },
        { key: 'other_procurement_reserved_micro', value_numeric: asNumericOrNull(form.procurement_reserved_micro) },
        { key: 'other_procurement_no_budget', value_text: form.procurement_no_budget ? '1' : '0' },
        { key: 'procurement_notes', value_text: form.procurement_notes || null },
        { key: 'other_performance_unit_count', value_numeric: asNumericOrNull(form.performance_unit_count) },
        { key: 'other_performance_project_count', value_numeric: asNumericOrNull(form.performance_project_count) },
        { key: 'other_performance_budget', value_numeric: asNumericOrNull(form.performance_budget) },
        { key: 'other_performance_notes', value_text: form.performance_notes || null },
        { key: 'state_owned_assets', value_text: form.state_owned_assets.trim() || buildAssetsSection(form, draftYear) },
        { key: 'asset_total', value_numeric: asNumericOrNull(form.asset_total) },
        { key: 'other_asset_vehicle_total', value_numeric: asNumericOrNull(form.asset_vehicle_total) },
        { key: 'other_asset_device_over_million', value_numeric: asNumericOrNull(form.asset_device_over_million) },
        { key: 'other_asset_purchase_vehicle_count', value_numeric: asNumericOrNull(form.asset_purchase_vehicle_count) },
        { key: 'other_asset_purchase_device_over_million', value_numeric: asNumericOrNull(form.asset_purchase_device_over_million) },
        { key: 'asset_notes', value_text: form.asset_notes || null },
        { key: 'other_notes', value_text: previewText }
      ];

      await onSaveManualInputs(payload);
      setAutoMessage('其他相关情况说明已保存，并同步生成整段文本。');
    } catch (e) {
      setError('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const inlineAmountInputClass = 'mx-1 inline-block w-28 border-0 border-b border-slate-400 bg-transparent px-1 text-center text-sm focus:border-brand-600 focus:outline-none';
  const inlineCountInputClass = 'mx-1 inline-block w-20 border-0 border-b border-slate-400 bg-transparent px-1 text-center text-sm focus:border-brand-600 focus:outline-none';
  const inlineReasonInputClass = 'mx-1 inline-block w-80 max-w-full border-0 border-b border-slate-400 bg-transparent px-1 text-sm focus:border-brand-600 focus:outline-none';

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center justify-between gap-3">
        <div>系统将自动提取可识别字段（如三公、机关运行），其余字段需手工补充。</div>
        <button
          type="button"
          onClick={() => void fillAutoValues()}
          disabled={loadingAuto}
          className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-600 hover:bg-white disabled:bg-slate-200"
        >
          {loadingAuto ? '提取中...' : '从表格自动提取'}
        </button>
      </div>

      {autoMessage ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{autoMessage}</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div> : null}
      {unavailableTips.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
          <div className="font-medium">以下字段未从表格识别，请手动补充：</div>
          {unavailableTips.map((tip) => (
            <div key={tip.key}>- {tip.label}：{tip.reason}</div>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">一、{draftYear}年“三公”经费预算情况说明（模板填空）</h3>
        <div className="text-sm leading-8 text-slate-700 space-y-2">
          <p>
            {draftYear}年“三公”经费预算数为
            <input value={form.three_public_total} onChange={(e) => update('three_public_total', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，比{draftYear - 1}年预算增加（减少）
            <input value={form.three_public_total_prev} onChange={(e) => update('three_public_total_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元（持平）。其中：
          </p>
          <p>
            （一）因公出国（境）费
            <input value={form.outbound_fee} onChange={(e) => update('outbound_fee', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，比{draftYear - 1}年预算增加（减少）
            <input value={form.outbound_fee_prev} onChange={(e) => update('outbound_fee_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，主要原因是
            <input value={form.outbound_reason} onChange={(e) => update('outbound_reason', e.target.value)} placeholder="……" className={inlineReasonInputClass} />
            。
          </p>
          <p>
            （二）公务用车购置及运行费
            <input value={form.vehicle_total_fee} onChange={(e) => update('vehicle_total_fee', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，比{draftYear - 1}年预算增加（减少）
            <input value={form.vehicle_total_fee_prev} onChange={(e) => update('vehicle_total_fee_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，主要原因是
            <input value={form.vehicle_total_reason} onChange={(e) => update('vehicle_total_reason', e.target.value)} placeholder="……" className={inlineReasonInputClass} />
            。
          </p>
          <p>
            其中：公务用车购置费
            <input value={form.vehicle_purchase_fee} onChange={(e) => update('vehicle_purchase_fee', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，比{draftYear - 1}年预算增加（减少）
            <input value={form.vehicle_purchase_fee_prev} onChange={(e) => update('vehicle_purchase_fee_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，主要原因是
            <input value={form.vehicle_purchase_reason} onChange={(e) => update('vehicle_purchase_reason', e.target.value)} placeholder="……" className={inlineReasonInputClass} />
            ；公务用车运行费
            <input value={form.vehicle_operation_fee} onChange={(e) => update('vehicle_operation_fee', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，比{draftYear - 1}年预算增加（减少）
            <input value={form.vehicle_operation_fee_prev} onChange={(e) => update('vehicle_operation_fee_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，主要原因是
            <input value={form.vehicle_operation_reason} onChange={(e) => update('vehicle_operation_reason', e.target.value)} placeholder="……" className={inlineReasonInputClass} />
            。
          </p>
          <p>
            （三）公务接待费
            <input value={form.reception_fee} onChange={(e) => update('reception_fee', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，比{draftYear - 1}年预算增加（减少）
            <input value={form.reception_fee_prev} onChange={(e) => update('reception_fee_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
            万元，主要原因是
            <input value={form.reception_reason} onChange={(e) => update('reception_reason', e.target.value)} placeholder="……" className={inlineReasonInputClass} />
            。
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">二、机关运行经费预算（模板填空）</h3>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.operation_no_fund} onChange={(e) => update('operation_no_fund', e.target.checked)} />
          本部门无机关运行经费
        </label>
        <p className="text-sm leading-8 text-slate-700">
          {form.operation_no_fund ? (
            <>本部门无机关运行经费。</>
          ) : (
            <>
              {draftYear}年
              <input value={form.unit_name} onChange={(e) => update('unit_name', e.target.value)} placeholder="XX（部门）" className={inlineReasonInputClass} />
              下属
              <input value={form.operation_org_count} onChange={(e) => update('operation_org_count', e.target.value)} placeholder="X" className={inlineCountInputClass} />
              家机关和
              <input value={form.operation_ref_org_count} onChange={(e) => update('operation_ref_org_count', e.target.value)} placeholder="X" className={inlineCountInputClass} />
              家参公事业单位财政拨款的机关运行经费预算为
              <input value={form.operation_fund} onChange={(e) => update('operation_fund', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
              万元，比{draftYear - 1}年预算增加（减少）
              <input value={form.operation_fund_prev} onChange={(e) => update('operation_fund_prev', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
              万元。
            </>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">三、政府采购预算情况（模板填空）</h3>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.procurement_no_budget} onChange={(e) => update('procurement_no_budget', e.target.checked)} />
          本部门未安排政府采购预算
        </label>
        <div className="text-sm leading-8 text-slate-700 space-y-2">
          {form.procurement_no_budget ? (
            <p>
              上海市普陀区
              <input value={form.unit_name} onChange={(e) => update('unit_name', e.target.value)} placeholder="XX部门" className={inlineReasonInputClass} />
              {draftYear}年未安排政府采购预算。
            </p>
          ) : (
            <>
              <p>
                {draftYear}年本部门政府采购预算
                <input value={form.procurement_total} onChange={(e) => update('procurement_total', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
                万元，其中：政府采购货物预算
                <input value={form.procurement_goods} onChange={(e) => update('procurement_goods', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
                万元、政府采购工程预算
                <input value={form.procurement_project} onChange={(e) => update('procurement_project', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
                万元、政府采购服务预算
                <input value={form.procurement_service} onChange={(e) => update('procurement_service', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
                万元。
              </p>
              <p>
                {draftYear}年本部门面向中小企业预留政府采购项目预算金额
                <input value={form.procurement_reserved_sme} onChange={(e) => update('procurement_reserved_sme', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
                万元，其中，预留给小型和微型企业的政府采购项目预算为
                <input value={form.procurement_reserved_micro} onChange={(e) => update('procurement_reserved_micro', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
                万元。
              </p>
            </>
          )}
          <p className="text-xs text-slate-500">补充说明（可选）</p>
          <textarea value={form.procurement_notes} onChange={(e) => update('procurement_notes', e.target.value)} rows={2} placeholder="可填写口径变化、政策调整等补充说明" className="w-full px-3 py-2 border rounded-lg" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">四、绩效目标设置情况（模板填空）</h3>
        <p className="text-sm leading-8 text-slate-700">
          按照本区预算绩效管理工作的总体要求，本部门
          <input value={form.performance_unit_count} onChange={(e) => update('performance_unit_count', e.target.value)} placeholder="XXX" className={inlineCountInputClass} />
          个预算单位开展了{draftYear}年项目预算绩效目标编报工作，编报绩效目标的项目
          <input value={form.performance_project_count} onChange={(e) => update('performance_project_count', e.target.value)} placeholder="XXX" className={inlineCountInputClass} />
          个，涉及项目预算资金
          <input value={form.performance_budget} onChange={(e) => update('performance_budget', e.target.value)} placeholder="XXX" className={inlineAmountInputClass} />
          万元。
        </p>
        <p className="text-xs text-slate-500">补充说明（可选）</p>
        <textarea value={form.performance_notes} onChange={(e) => update('performance_notes', e.target.value)} rows={2} placeholder="可填写绩效目标管理工作情况等" className="w-full px-3 py-2 border rounded-lg" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">五、国有资产占有使用情况（模板填空）</h3>
        <p className="text-sm leading-8 text-slate-700">
          截至{draftYear - 1}年8月31日，
          <input value={form.unit_name} onChange={(e) => update('unit_name', e.target.value)} placeholder="XX（部门）" className={inlineReasonInputClass} />
          共有车辆
          <input value={form.asset_vehicle_total} onChange={(e) => update('asset_vehicle_total', e.target.value)} placeholder="XX" className={inlineCountInputClass} />
          辆；单价100万元（含）以上设备（不含车辆）
          <input value={form.asset_device_over_million} onChange={(e) => update('asset_device_over_million', e.target.value)} placeholder="XX" className={inlineCountInputClass} />
          台（套）。
        </p>
        <p className="text-sm leading-8 text-slate-700">
          {draftYear}年部门预算安排购置车辆
          <input value={form.asset_purchase_vehicle_count} onChange={(e) => update('asset_purchase_vehicle_count', e.target.value)} placeholder="XX" className={inlineCountInputClass} />
          辆；部门预算安排购置单价100万元（含）以上设备（不含车辆）
          <input value={form.asset_purchase_device_over_million} onChange={(e) => update('asset_purchase_device_over_million', e.target.value)} placeholder="XX" className={inlineCountInputClass} />
          台（套）。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={form.asset_total} onChange={(e) => update('asset_total', e.target.value)} placeholder="资产总额（万元，可选）" className="px-3 py-2 border rounded-lg" />
          <input value={form.unit_name} onChange={(e) => update('unit_name', e.target.value)} placeholder="部门名称（用于自动成文）" className="px-3 py-2 border rounded-lg" />
        </div>
        <textarea value={form.asset_notes} onChange={(e) => update('asset_notes', e.target.value)} rows={2} placeholder="资产补充说明（可选）" className="w-full px-3 py-2 border rounded-lg" />
        <textarea ref={stateAssetsRef} value={form.state_owned_assets} onChange={(e) => update('state_owned_assets', e.target.value)} rows={3} placeholder="如需直接覆盖第五段全文，可在此粘贴/编辑" className="w-full px-3 py-2 border rounded-lg" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-base font-semibold text-slate-900">实时成稿预览（第六部分）</h3>
        <textarea readOnly value={previewText} rows={16} className="w-full px-3 py-2 border rounded-lg bg-slate-50 text-sm text-slate-700" />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300"
        >
          {saving ? '保存中...' : '保存并生成第六部分'}
        </button>
      </div>
    </div>
  );
};
