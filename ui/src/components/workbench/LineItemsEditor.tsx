import React, { useState, useEffect } from 'react';
import { apiClient } from '../../utils/apiClient';

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

interface LineItemsEditorProps {
  draftId: string;
  ifMatchUpdatedAt?: string | null;
  onSave?: (result: any) => void;
  onStatsChange?: (stats: { total: number; required: number; missing: number }) => void;
}

const calculateStats = (items: LineItem[]) => ({
  total: items.length,
  required: items.filter((item) => item.reason_required).length,
  missing: items.filter((item) => item.reason_required && !(item.reason_text || '').trim()).length
});

export const LineItemsEditor: React.FC<LineItemsEditorProps> = ({ draftId, ifMatchUpdatedAt, onSave, onStatsChange }) => {
  const [items, setItems] = useState<LineItem[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'needs_reason' | 'missing'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadLineItems();
  }, [draftId]);

  const loadLineItems = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getLineItems(draftId);
      const nextItems = response.items || [];
      setItems(nextItems);
      setThreshold(response.threshold || 0);
      onStatsChange?.(calculateStats(nextItems));
    } catch (error) {
      console.error('Failed to load line items:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReasonChange = (itemKey: string, reason: string) => {
    setItems((prev) => {
      const nextItems = prev.map((item) =>
        item.item_key === itemKey ? { ...item, reason_text: reason } : item
      );
      onStatsChange?.(calculateStats(nextItems));
      return nextItems;
    });
  };

  const buildDefaultReasonText = (item: LineItem) => {
    const label = item.item_label || '';
    const current = Number(item.amount_current_wanyuan ?? 0).toFixed(2);
    const prev = Number(item.amount_prev_wanyuan ?? 0).toFixed(2);
    let reason = (item.previous_reason_text || '').trim();
    reason = reason.replace(/^主要(原因是)?[:：]?\s*/, '').trim();
    if (!reason) reason = '原因待补充';
    return `“${label}”${current}万元，上年:${prev}万元，主要${reason}。`;
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const itemsToSave = items.map((item) => ({
        item_key: item.item_key,
        reason_text: item.reason_text || null,
        order_no: item.order_no,
      }));

      const response = await apiClient.updateLineItems(draftId, {
        items: itemsToSave,
        if_match_updated_at: ifMatchUpdatedAt || undefined
      });
      onStatsChange?.(calculateStats(items));
      onSave?.(response);
    } catch (error) {
      console.error('Failed to save line items:', error);
      alert('保存失败，可能是草稿已被他人更新，请刷新后重试');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredItems = items.filter((item) => {
    // 搜索过滤
    if (searchTerm && !item.item_label.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }

    // 类型过滤
    if (filter === 'needs_reason') {
      return item.reason_required;
    } else if (filter === 'missing') {
      return item.reason_required && !(item.reason_text || '').trim();
    }
    return true;
  });

  const missingCount = items.filter((item) => item.reason_required && !(item.reason_text || '').trim()).length;

  if (isLoading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">财政拨款支出主要内容逐条列示</h3>
        <div className="text-sm text-gray-600">
          变动阈值: {threshold}万元 | 缺失原因: <span className="text-red-600 font-semibold">{missingCount}</span> 条
        </div>
      </div>

      <div className="flex gap-4">
        <input
          type="text"
          placeholder="搜索条目..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">全部条目</option>
          <option value="needs_reason">需填原因</option>
          <option value="missing">缺失原因</option>
        </select>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {filteredItems.map((item) => {
          const changeAmount = (item.amount_current_wanyuan !== null && item.amount_current_wanyuan !== undefined &&
            item.amount_prev_wanyuan !== null && item.amount_prev_wanyuan !== undefined)
            ? item.amount_current_wanyuan - item.amount_prev_wanyuan
            : undefined;
          const changePercent = item.change_ratio !== null && item.change_ratio !== undefined
            ? item.change_ratio * 100
            : undefined;

          return (
            <div
              key={item.item_key}
              className={`p-4 border rounded-lg ${item.reason_required && !(item.reason_text || '').trim() ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{item.item_label}</h4>
                  <div className="mt-1 text-sm text-gray-600 space-x-4">
                    <span>本年: {item.amount_current_wanyuan?.toFixed(2) || 0} 万元</span>
                    <span>上年: {item.amount_prev_wanyuan?.toFixed(2) || 0} 万元</span>
                    {changeAmount !== undefined && (
                      <span className={changeAmount >= 0 ? 'text-green-600' : 'text-red-600'}>
                        变动: {changeAmount >= 0 ? '+' : ''}{changeAmount.toFixed(2)} 万元
                        {changePercent !== undefined && ` (${changePercent.toFixed(1)}%)`}
                      </span>
                    )}
                  </div>
                </div>
                {item.reason_required && (
                  <span className="px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded">
                    需填原因
                  </span>
                )}
              </div>
              <textarea
                value={item.reason_text || ''}
                onChange={(e) => handleReasonChange(item.item_key, e.target.value)}
                placeholder={item.reason_required ? '请填写变动原因...' : '可选填写说明...'}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${item.reason_required && !(item.reason_text || '').trim() ? 'border-red-300' : 'border-gray-300'
                  }`}
                rows={2}
              />
              {item.previous_reason_text && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-700">去年说明</span>
                    <button
                      type="button"
                      onClick={() => handleReasonChange(item.item_key, buildDefaultReasonText(item))}
                      className="text-xs text-brand-600 hover:text-brand-700"
                    >
                      复用去年
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap">{item.previous_reason_text}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredItems.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          {searchTerm ? '没有找到匹配的条目' : '没有需要填写的条目'}
        </div>
      )}

      <div className="flex justify-end pt-4 border-t">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSaving ? '保存中...' : '保存原因'}
        </button>
      </div>
    </div>
  );
};
