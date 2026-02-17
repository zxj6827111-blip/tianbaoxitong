import React, { useState } from 'react';
import Button from '../ui/Button';
import { Modal } from '../ui/Modal';
import Input from '../ui/Input';
import { Spinner } from '../ui/Loading';

interface DataParseModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string;
  onSave: (items: ParsedItem[]) => Promise<void>;
}

interface ParsedItem {
  key: string;
  value: number;
}

export const DataParseModal: React.FC<DataParseModalProps> = ({
  isOpen,
  onClose,
  reportId,
  onSave
}) => {
  const [engine, setEngine] = useState<'local' | 'ai'>('local');
  const [model, setModel] = useState('ZhipuAI/GLM-4.7-Flash');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const [items, setItems] = useState<ParsedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'config' | 'preview'>('config');

  const handleParse = async () => {
    setIsLoading(true);
    setError(null);
    try {
      let endpoint = '/api/admin/archives/parse-budget-table';
      const body: Record<string, unknown> = { report_id: reportId };

      if (engine === 'ai') {
        endpoint = '/api/admin/archives/parse-budget-table-ai';
        body.model_config = {
          provider: 'openai',
          apiKey,
          model,
          baseUrl: baseUrl || undefined
        };
      }

      const token = localStorage.getItem('auth_token');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.message || '解析失败，请稍后重试');
      }

      const data = await response.json();
      if (data.error === 'NO_SOURCE_TEXT') {
        throw new Error('PDF 未提取到可解析文本，请先执行 OCR 再重试。');
      }

      setItems(Array.isArray(data.items) ? data.items : []);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onSave(items);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal title="提取表格数据" isOpen={isOpen} onClose={onClose} size="xl">
      <div className="space-y-4">
        {step === 'config' && (
          <>
            <div className="flex space-x-4">
              <button
                type="button"
                className={`flex-1 py-2 px-4 rounded border ${engine === 'local' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-gray-200'}`}
                onClick={() => setEngine('local')}
              >
                本地规则
              </button>
              <button
                type="button"
                className={`flex-1 py-2 px-4 rounded border ${engine === 'ai' ? 'bg-purple-50 border-purple-500 text-purple-700' : 'border-gray-200'}`}
                onClick={() => setEngine('ai')}
              >
                AI 增强
              </button>
            </div>

            {engine === 'local' ? (
              <div className="bg-gray-50 p-4 rounded text-sm text-gray-600">
                使用内置规则提取“字段名 + 数值”。速度快、成本低，适合常规预算表。
              </div>
            ) : (
              <div className="space-y-3 bg-purple-50 p-4 rounded border border-purple-100">
                <div>
                  <label className="block text-sm font-medium text-purple-900 mb-1">模型</label>
                  <select
                    className="w-full border rounded p-2 text-sm"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    <option value="ZhipuAI/GLM-4.7-Flash">ZhipuAI/GLM-4.7-Flash</option>
                    <option value="Qwen/Qwen2.5-72B-Instruct">Qwen/Qwen2.5-72B-Instruct</option>
                    <option value="deepseek-ai/DeepSeek-V3">deepseek-ai/DeepSeek-V3</option>
                    <option value="deepseek-chat">deepseek-chat</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-900 mb-1">API Key</label>
                  <Input type="password" placeholder="sk-..." value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-900 mb-1">Base URL（可选）</label>
                  <Input placeholder="https://..." value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                </div>
              </div>
            )}

            {error ? <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div> : null}

            <div className="flex justify-end">
              <Button onClick={handleParse} disabled={isLoading}>
                {isLoading ? <Spinner size="sm" className="mr-2" /> : null}
                开始提取
              </Button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <div className="flex flex-col h-[70vh]">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">提取预览（{items.length} 条）</h3>
              <button type="button" className="text-sm text-gray-500 hover:text-gray-700" onClick={() => setStep('config')}>
                返回配置
              </button>
            </div>
            <div className="flex-1 overflow-auto border rounded bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left border-b w-2/3">字段</th>
                    <th className="p-2 text-right border-b">数值</th>
                    <th className="p-2 border-b w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={3} className="p-8 text-center text-gray-400">没有提取到数据</td></tr>
                  ) : items.map((item, idx) => (
                    <tr key={`${item.key}-${idx}`} className="border-b hover:bg-gray-50">
                      <td className="p-2">
                        <input
                          className="w-full bg-transparent border-none focus:ring-0 p-0"
                          value={item.key}
                          onChange={(event) => setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, key: event.target.value } : row)))}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-right"
                          value={item.value}
                          onChange={(event) => setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, value: Number(event.target.value) } : row)))}
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button type="button" className="text-red-400 hover:text-red-600" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>
                          x
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error ? <div className="bg-red-50 text-red-600 p-3 rounded text-sm mt-3">{error}</div> : null}
            <div className="flex justify-end pt-4 space-x-2">
              <Button onClick={() => setStep('config')}>返回</Button>
              <Button onClick={handleSave} disabled={isLoading || items.length === 0}>
                {isLoading ? <Spinner size="sm" className="mr-2" /> : null}
                确认
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

