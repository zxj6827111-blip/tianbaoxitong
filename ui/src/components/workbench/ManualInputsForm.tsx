import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';


interface ManualInput {
  id?: number;
  key: string;
  value_text?: string | null;
  value_numeric?: number | null;
  notes?: string;
}

export type InputFieldKey =
  | 'main_functions'
  | 'organizational_structure'
  | 'glossary'
  | 'budget_explanation'
  | 'budget_change_reason'
  | 'procurement_amount'
  | 'procurement_notes'
  | 'project_overview'
  | 'project_basis'
  | 'project_subject'
  | 'project_plan'
  | 'project_cycle'
  | 'project_budget_arrangement'
  | 'project_performance_goal'
  | 'performance_target'
  | 'performance_result'
  | 'asset_total'
  | 'asset_notes'
  | 'state_owned_assets'
  | 'unit_full_name'
  | 'report_contact';

interface ManualInputState {
  main_functions: string;
  organizational_structure: string;
  glossary: string;
  budget_explanation: string;
  budget_change_reason: string;
  procurement_amount: string;
  procurement_notes: string;
  project_overview: string;
  project_basis: string;
  project_subject: string;
  project_plan: string;
  project_cycle: string;
  project_budget_arrangement: string;
  project_performance_goal: string;
  performance_target: string;
  performance_result: string;
  asset_total: string;
  asset_notes: string;
  state_owned_assets: string;
  unit_full_name: string;
  report_contact: string;
}

export type ManualFormSection =
  | 'main_functions'
  | 'organizational_structure'
  | 'glossary'
  | 'budget_explanation'
  | 'other_related'
  | 'project_expense';

interface ManualInputsFormProps {
  draftId: string;
  initialInputs?: ManualInput[];
  onSave: (inputs: ManualInput[]) => Promise<void>;
  onReuseHistory?: (key: string) => Promise<string | null>;
  section?: ManualFormSection;
  autoSave?: boolean;
  onCompletionChange?: (completed: boolean) => void;
  focusRequest?: {
    key: InputFieldKey;
    nonce: number;
  } | null;
}

const SECTION_FIELDS: Record<ManualFormSection, InputFieldKey[]> = {
  main_functions: ['main_functions'],
  organizational_structure: ['organizational_structure'],
  glossary: ['glossary'],
  budget_explanation: ['budget_explanation', 'budget_change_reason'],
  other_related: ['state_owned_assets', 'procurement_amount', 'procurement_notes', 'asset_total', 'asset_notes'],
  project_expense: [
    'project_overview',
    'project_basis',
    'project_subject',
    'project_plan',
    'project_cycle',
    'project_budget_arrangement',
    'project_performance_goal'
  ]
};

const SECTION_TITLES: Record<ManualFormSection, string> = {
  main_functions: '部门主要职能',
  organizational_structure: '部门机构设置',
  glossary: '名词解释',
  budget_explanation: '部门预算编制说明',
  other_related: '其他相关情况说明',
  project_expense: '项目经费情况说明'
};

const NUMERIC_FIELDS: InputFieldKey[] = ['procurement_amount', 'asset_total'];

// ============================================================
// 自动排版：对引用的历史文本进行段落规范化
// ============================================================

/** 需要自动排版的字段（部门主要职能、部门机构设置、名词解释） */
const AUTO_FORMAT_FIELDS: InputFieldKey[] = ['main_functions', 'organizational_structure', 'glossary'];

/**
 * 智能排版文本
 *
 * 处理逻辑：
 *  1. 统一换行符
 *  2. 去除每行首尾多余空格（Tab / 半角空格）
 *  3. 去除所有空行（空行不作为段落分隔）
 *  4. 合并断行：如果某行末尾没有中文句末标点（。！？；…），
 *     且下一行不是编号开头，说明是被截断的一句话，自动合并
 *  5. 首尾去空白
 *
 * 编号行（一、二、三 / 1. / （1） 等）之间用换行分隔但不插入额外空行。
 */
function formatTextContent(raw: string): string {
  if (!raw || !raw.trim()) return raw;

  // 1. 统一换行符
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // 2. 去除每行首尾多余半角空格和 Tab
  const trimmedLines = lines
    .map((line) => line.trimEnd())
    .map((line) => line.replace(/^[ \t]+/, ''));

  // 3. 过滤掉纯空行
  const nonEmptyLines = trimmedLines.filter((line) => line !== '');

  // 4. 识别编号行的正则
  // 支持：（一）（二） / 一、二、 / （1）（2） / 1. / 第一条 / 【 等
  const isNumberedLine = (line: string) =>
    /^(?:[（(]?[一二三四五六七八九十百]+[、）)]|[（(]\d+[）)]|\d+[.、．]|第[一二三四五六七八九十百]+[条章节款项]|【)/.test(line);

  // 中文句末标点：句号、叹号、问号、分号、省略号（两个省略号）、顿号结尾不算
  const endsWithSentencePunct = (line: string) =>
    /[。！？；…」』】"'）\]）]$/.test(line);

  // 5. 合并断行：逐行检查，若当前行未以句末标点结尾，且下一行不是编号行，则合并
  const merged: string[] = [];
  let buffer = '';

  for (let i = 0; i < nonEmptyLines.length; i++) {
    const line = nonEmptyLines[i];

    if (buffer === '') {
      buffer = line;
    } else {
      // 当前 buffer 末尾是否是完整句子？
      if (!endsWithSentencePunct(buffer) && !isNumberedLine(line)) {
        // 不完整且下一行不是新编号段 → 合并（直接拼接，不加空格）
        buffer += line;
      } else {
        // 完整句子或下一行是编号段 → 推入结果，开始新 buffer
        merged.push(buffer);
        buffer = line;
      }
    }
  }
  if (buffer !== '') {
    merged.push(buffer);
  }

  // 6. 首尾去空白，段落之间用单个换行连接
  return merged.join('\n').trim();
}

const getInputByKey = (inputs: ManualInput[], key: string) => inputs.find((item) => item.key === key);

const toStringValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const createInitialState = (initialInputs: ManualInput[]): ManualInputState => ({
  main_functions: toStringValue(getInputByKey(initialInputs, 'main_functions')?.value_text),
  organizational_structure: toStringValue(getInputByKey(initialInputs, 'organizational_structure')?.value_text),
  glossary: toStringValue(getInputByKey(initialInputs, 'glossary')?.value_text),
  budget_explanation: toStringValue(getInputByKey(initialInputs, 'budget_explanation')?.value_text),
  budget_change_reason: toStringValue(getInputByKey(initialInputs, 'budget_change_reason')?.value_text),
  procurement_amount: toStringValue(getInputByKey(initialInputs, 'procurement_amount')?.value_numeric),
  procurement_notes: toStringValue(getInputByKey(initialInputs, 'procurement_notes')?.value_text),
  project_overview: toStringValue(getInputByKey(initialInputs, 'project_overview')?.value_text),
  project_basis: toStringValue(getInputByKey(initialInputs, 'project_basis')?.value_text),
  project_subject: toStringValue(getInputByKey(initialInputs, 'project_subject')?.value_text),
  project_plan: toStringValue(getInputByKey(initialInputs, 'project_plan')?.value_text),
  project_cycle: toStringValue(getInputByKey(initialInputs, 'project_cycle')?.value_text),
  project_budget_arrangement: toStringValue(getInputByKey(initialInputs, 'project_budget_arrangement')?.value_text),
  project_performance_goal: toStringValue(getInputByKey(initialInputs, 'project_performance_goal')?.value_text)
    || toStringValue(getInputByKey(initialInputs, 'performance_target')?.value_text)
    || toStringValue(getInputByKey(initialInputs, 'performance_result')?.value_text),
  performance_target: toStringValue(getInputByKey(initialInputs, 'performance_target')?.value_text),
  performance_result: toStringValue(getInputByKey(initialInputs, 'performance_result')?.value_text),
  asset_total: toStringValue(getInputByKey(initialInputs, 'asset_total')?.value_numeric),
  asset_notes: toStringValue(getInputByKey(initialInputs, 'asset_notes')?.value_text),
  state_owned_assets: toStringValue(getInputByKey(initialInputs, 'state_owned_assets')?.value_text),
  unit_full_name: toStringValue(getInputByKey(initialInputs, 'unit_full_name')?.value_text),
  report_contact: toStringValue(getInputByKey(initialInputs, 'report_contact')?.value_text)
});

const buildManualInputs = (state: ManualInputState, fields: InputFieldKey[]): ManualInput[] => {
  return fields.map((key) => {
    if (NUMERIC_FIELDS.includes(key)) {
      const raw = state[key].trim();
      const parsed = raw === '' ? null : Number(raw);
      return {
        key,
        value_numeric: parsed !== null && Number.isFinite(parsed) ? parsed : null
      };
    }

    return {
      key,
      value_text: state[key]
    };
  });
};

const isNonEmpty = (value: string) => value.trim().length > 0;

const isSectionCompleted = (section: ManualFormSection, state: ManualInputState) => {
  switch (section) {
    case 'main_functions':
      return isNonEmpty(state.main_functions);
    case 'organizational_structure':
      return isNonEmpty(state.organizational_structure);
    case 'glossary':
      return isNonEmpty(state.glossary);
    case 'budget_explanation':
      return isNonEmpty(state.budget_change_reason);
    case 'other_related':
      return [
        state.state_owned_assets,
        state.procurement_notes,
        state.asset_notes,
        state.procurement_amount,
        state.asset_total
      ].some((value) => isNonEmpty(value));
    case 'project_expense':
      return isNonEmpty(state.project_overview)
        && isNonEmpty(state.project_basis)
        && isNonEmpty(state.project_subject)
        && isNonEmpty(state.project_plan)
        && isNonEmpty(state.project_cycle)
        && isNonEmpty(state.project_budget_arrangement)
        && isNonEmpty(state.project_performance_goal);
    default:
      return false;
  }
};

export const ManualInputsForm: React.FC<ManualInputsFormProps> = ({
  initialInputs = [],
  onSave,
  onReuseHistory,
  section = 'main_functions',
  autoSave = true,
  onCompletionChange,
  focusRequest
}) => {
  const activeFields = useMemo(() => SECTION_FIELDS[section], [section]);
  const [inputs, setInputs] = useState<ManualInputState>(() => createInitialState(initialInputs));
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const lastSavedSignatureRef = useRef<string>('');

  useEffect(() => {
    const next = createInitialState(initialInputs);
    setInputs(next);
    lastSavedSignatureRef.current = JSON.stringify(buildManualInputs(next, activeFields));
    setSaveError(null);
  }, [initialInputs, activeFields]);

  useEffect(() => {
    onCompletionChange?.(isSectionCompleted(section, inputs));
  }, [section, inputs, onCompletionChange]);

  useEffect(() => {
    if (!focusRequest || !activeFields.includes(focusRequest.key)) {
      return;
    }

    const targetId = `manual-input-${focusRequest.key}`;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(targetId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!element) {
        return;
      }
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [focusRequest, activeFields]);

  const persist = useCallback(async (mode: 'manual' | 'auto') => {
    if (isSaving || isAutoSaving) {
      return;
    }

    const payload = buildManualInputs(inputs, activeFields);
    const signature = JSON.stringify(payload);

    if (signature === lastSavedSignatureRef.current) {
      return;
    }

    if (mode === 'auto') {
      setIsAutoSaving(true);
    } else {
      setIsSaving(true);
    }

    try {
      await onSave(payload);
      lastSavedSignatureRef.current = signature;
      setSaveError(null);
    } catch (error) {
      setSaveError('保存失败，请稍后重试');
      throw error;
    } finally {
      setIsSaving(false);
      setIsAutoSaving(false);
    }
  }, [activeFields, inputs, isAutoSaving, isSaving, onSave]);

  useEffect(() => {
    if (!autoSave || isSaving || isAutoSaving) {
      return;
    }

    const timer = window.setTimeout(() => {
      persist('auto').catch(() => {
        // no-op: error message is already shown in UI
      });
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [inputs, autoSave, isAutoSaving, isSaving, persist]);

  const handleChange = (key: InputFieldKey, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSmartFill = async (key: InputFieldKey) => {
    if (!onReuseHistory) {
      return;
    }

    const text = await onReuseHistory(key);
    if (text !== null && text !== undefined) {
      // 对三个文本字段自动执行排版
      const formatted = AUTO_FORMAT_FIELDS.includes(key) ? formatTextContent(text) : text;
      handleChange(key, formatted);
    }
  };


  const renderReuseButton = (key: InputFieldKey) => {
    if (!onReuseHistory) {
      return null;
    }

    return (
      <button
        type="button"
        onClick={() => handleSmartFill(key)}
        className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2 py-1 rounded transition-colors"
      >
        <History className="w-3 h-3" />
        引用历史
      </button>
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await persist('manual');
  };

  const renderTextAreaField = (
    key: InputFieldKey,
    label: string,
    placeholder: string,
    rows = 4,
    withHistory = false
  ) => (
    <div>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      )}
      <textarea
        id={`manual-input-${key}`}
        value={inputs[key]}
        onChange={(e) => handleChange(key, e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
        rows={rows}
        placeholder={placeholder}
      />
      {withHistory && (
        <div className="flex justify-end mt-2">
          {renderReuseButton(key)}
        </div>
      )}
    </div>
  );


  const renderNumberField = (key: InputFieldKey, label: string, placeholder: string) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <input
        id={`manual-input-${key}`}
        type="number"
        step="0.01"
        value={inputs[key]}
        onChange={(e) => handleChange(key, e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">

        {activeFields.includes('main_functions') && (
          renderTextAreaField('main_functions', '', '请输入部门主要职能', 16, true)
        )}

        {activeFields.includes('organizational_structure') && (
          renderTextAreaField('organizational_structure', '', '请输入机构设置情况', 16, true)
        )}

        {activeFields.includes('glossary') && (
          renderTextAreaField('glossary', '', '请输入名词解释', 16, true)
        )}

        {activeFields.includes('budget_explanation') && (
          renderTextAreaField('budget_explanation', '预算编制说明（可自动生成后再修改）', '请输入部门预算编制说明', 5, true)
        )}

        {activeFields.includes('budget_change_reason') && (
          renderTextAreaField('budget_change_reason', '财政拨款收入支出增加（减少）的主要原因', '请输入财政拨款收入支出增减原因', 4)
        )}

        {activeFields.includes('state_owned_assets') && (
          renderTextAreaField('state_owned_assets', '国有资产占有使用情况', '请输入国有资产占有使用情况', 4)
        )}

        {activeFields.includes('procurement_amount') && (
          renderNumberField('procurement_amount', '政府采购金额（万元）', '请输入采购金额')
        )}

        {activeFields.includes('procurement_notes') && (
          renderTextAreaField('procurement_notes', '政府采购情况说明', '请输入采购情况说明', 3, true)
        )}

        {activeFields.includes('asset_total') && (
          renderNumberField('asset_total', '资产总额（万元）', '请输入资产总额')
        )}

        {activeFields.includes('asset_notes') && (
          renderTextAreaField('asset_notes', '资产情况说明', '请输入资产情况说明', 3, true)
        )}

        {activeFields.includes('project_overview') && (
          renderTextAreaField('project_overview', '一、项目概述', '说明项目的总体情况、立项目的等', 3, true)
        )}

        {activeFields.includes('project_basis') && (
          renderTextAreaField('project_basis', '二、立项依据', '说明立项依据的文件名称及具体依据内容', 3, true)
        )}

        {activeFields.includes('project_subject') && (
          renderTextAreaField('project_subject', '三、实施主体', '列举实施项目的责任主体及职责', 3, true)
        )}

        {activeFields.includes('project_plan') && (
          renderTextAreaField('project_plan', '四、实施方案', '说明项目实施阶段与实施内容', 3, true)
        )}

        {activeFields.includes('project_cycle') && (
          renderTextAreaField('project_cycle', '五、实施周期', '说明项目实施周期', 3, true)
        )}

        {activeFields.includes('project_budget_arrangement') && (
          renderTextAreaField('project_budget_arrangement', '六、年度预算安排', '说明年度财政资金预算安排金额与使用内容', 3, true)
        )}

        {activeFields.includes('project_performance_goal') && (
          renderTextAreaField('project_performance_goal', '七、绩效目标', '详见单位的项目绩效目标表', 3, true)
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-sm">
          {isAutoSaving ? <span className="text-slate-500">自动保存中...</span> : <span className="text-slate-400">已开启自动保存</span>}
          {saveError ? <span className="text-red-600 ml-2">{saveError}</span> : null}
        </div>
        <button
          type="submit"
          disabled={isSaving || isAutoSaving}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-400 disabled:cursor-not-allowed shadow-sm transition-all font-medium"
        >
          {isSaving || isAutoSaving ? '保存中...' : '手动保存'}
        </button>
      </div>
    </form>
  );
};
