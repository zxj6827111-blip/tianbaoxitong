import React, { useState } from 'react';
import { History } from 'lucide-react';

interface ManualInput {
  id?: number;
  key: string;
  value_text?: string;
  value_numeric?: number;
  notes?: string;
}

interface ManualInputsFormProps {
  draftId: number;
  initialInputs?: ManualInput[];
  onSave: (inputs: ManualInput[]) => Promise<void>;
  onReuseHistory?: (key: string) => Promise<string | null>;
}

export const ManualInputsForm: React.FC<ManualInputsFormProps> = ({
  draftId,
  initialInputs = [],
  onSave,
  onReuseHistory
}) => {
  const [inputs, setInputs] = useState<Record<string, any>>({
    procurement_amount: initialInputs.find((i) => i.key === 'procurement_amount')?.value_numeric || '',
    procurement_notes: initialInputs.find((i) => i.key === 'procurement_notes')?.value_text || '',
    performance_target: initialInputs.find((i) => i.key === 'performance_target')?.value_text || '',
    performance_result: initialInputs.find((i) => i.key === 'performance_result')?.value_text || '',
    asset_total: initialInputs.find((i) => i.key === 'asset_total')?.value_numeric || '',
    asset_notes: initialInputs.find((i) => i.key === 'asset_notes')?.value_text || '',
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (key: string, value: any) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSmartFill = async (key: string) => {
    if (onReuseHistory) {
      const text = await onReuseHistory(key);
      if (text) {
        handleChange(key, text);
      }
    }
  };

  const renderReuseButton = (key: string) => (
    onReuseHistory && (
      <button
        type="button"
        onClick={() => handleSmartFill(key)}
        className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 bg-brand-50  hover:bg-brand-100 px-2 py-1 rounded transition-colors"
      >
        <History className="w-3 h-3" />
        引用历史
      </button>
    )
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const manualInputs: ManualInput[] = [
        { key: 'procurement_amount', value_numeric: Number(inputs.procurement_amount) || 0 },
        { key: 'procurement_notes', value_text: inputs.procurement_notes },
        { key: 'performance_target', value_text: inputs.performance_target },
        { key: 'performance_result', value_text: inputs.performance_result },
        { key: 'asset_total', value_numeric: Number(inputs.asset_total) || 0 },
        { key: 'asset_notes', value_text: inputs.asset_notes },
      ];

      await onSave(manualInputs);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-slate-800">政府采购情况</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              采购金额(万元)
            </label>
            <input
              type="number"
              step="0.01"
              value={inputs.procurement_amount}
              onChange={(e) => handleChange('procurement_amount', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              placeholder="请输入采购金额"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-slate-700">
                采购说明
              </label>
              {renderReuseButton('procurement_notes')}
            </div>
            <textarea
              value={inputs.procurement_notes}
              onChange={(e) => handleChange('procurement_notes', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              rows={3}
              placeholder="请输入采购情况说明"
            />
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-slate-800">绩效目标</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
               <label className="block text-sm font-medium text-slate-700">
                绩效目标
              </label>
              {renderReuseButton('performance_target')}
            </div>
            <textarea
              value={inputs.performance_target}
              onChange={(e) => handleChange('performance_target', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              rows={3}
              placeholder="请输入绩效目标"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-slate-700">
                绩效完成情况
              </label>
              {renderReuseButton('performance_result')}
            </div>
            <textarea
              value={inputs.performance_result}
              onChange={(e) => handleChange('performance_result', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              rows={3}
              placeholder="请输入绩效完成情况"
            />
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-slate-800">资产情况</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              资产总额(万元)
            </label>
            <input
              type="number"
              step="0.01"
              value={inputs.asset_total}
              onChange={(e) => handleChange('asset_total', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              placeholder="请输入资产总额"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-slate-700">
                资产说明
              </label>
              {renderReuseButton('asset_notes')}
            </div>
            <textarea
              value={inputs.asset_notes}
              onChange={(e) => handleChange('asset_notes', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              rows={3}
              placeholder="请输入资产情况说明"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          type="submit"
          disabled={isSaving}
          className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-400 disabled:cursor-not-allowed shadow-sm transition-all"
        >
          {isSaving ? '保存中...' : '保存补录信息'}
        </button>
      </div>
    </form>
  );
};
