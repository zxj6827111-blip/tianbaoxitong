import React, { useState, useEffect } from 'react';
import { apiClient } from '../../utils/apiClient';

interface LineItem {
  item_key: string;
  label: string;
  current_value?: number;
  last_year_value?: number;
  change_amount?: number;
  change_percent?: number;
  reason_text?: string;
  needs_reason: boolean;
  order_no: number;
}

interface LineItemsEditorProps {
  draftId: number;
  onSave?: () => void;
}

export const LineItemsEditor: React.FC<LineItemsEditorProps> = ({ draftId, onSave }) => {
  const [items, setItems] = useState<LineItem[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'needs_reason' | 'missing'>('needs_reason');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadLineItems();
  }, [draftId]);

  const loadLineItems = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getLineItems(draftId);
      setItems(response.items || []);
      setThreshold(response.threshold || 0);
    } catch (error) {
      console.error('Failed to load line items:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReasonChange = (itemKey: string, reason: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.item_key === itemKey ? { ...item, reason_text: reason } : item
      )
    );
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const itemsToSave = items.map((item) => ({
        item_key: item.item_key,
        reason_text: item.reason_text || null,
        order_no: item.order_no,
      }));

      await apiClient.updateLineItems(draftId, itemsToSave);
      onSave?.();
    } catch (error) {
      console.error('Failed to save line items:', error);
      alert('保存失败,请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredItems = items.filter((item) => {
    // 搜索过滤
    if (searchTerm && !item.label.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }

    // 类型过滤
    if (filter === 'needs_reason') {
      return item.needs_reason;
    } else if (filter === 'missing') {
      return item.needs_reason && !item.reason_text;
    }
    return true;
  });

  const missingCount = items.filter((item) => item.needs_reason && !item.reason_text).length;

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
        {filteredItems.map((item) => (
          <div
            key={item.item_key}
            className={`p-4 border rounded-lg ${
              item.needs_reason && !item.reason_text ? 'border-red-300 bg-red-50' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <h4 className="font-medium text-gray-900">{item.label}</h4>
                <div className="mt-1 text-sm text-gray-600 space-x-4">
                  <span>本年: {item.current_value?.toFixed(2) || 0} 万元</span>
                  <span>上年: {item.last_year_value?.toFixed(2) || 0} 万元</span>
                  {item.change_amount !== undefined && (
                    <span className={item.change_amount >= 0 ? 'text-green-600' : 'text-red-600'}>
                      变动: {item.change_amount >= 0 ? '+' : ''}{item.change_amount.toFixed(2)} 万元
                      ({item.change_percent?.toFixed(1)}%)
                    </span>
                  )}
                </div>
              </div>
              {item.needs_reason && (
                <span className="px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded">
                  需填原因
                </span>
              )}
            </div>
            <textarea
              value={item.reason_text || ''}
              onChange={(e) => handleReasonChange(item.item_key, e.target.value)}
              placeholder={item.needs_reason ? '请填写变动原因...' : '可选填写说明...'}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                item.needs_reason && !item.reason_text ? 'border-red-300' : 'border-gray-300'
              }`}
              rows={2}
            />
          </div>
        ))}
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
