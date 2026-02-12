import React, { useState } from 'react';
import Button from '../ui/Button';
import { Modal } from '../ui/Modal';
import Input from '../ui/Input';
import { Spinner } from '../ui/Loading';

interface DataParseModalProps {
    isOpen: boolean;
    onClose: () => void;
    reportId: string;
    onSave: (items: any[]) => Promise<void>;
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
    const [model, setModel] = useState('ZhipuAI/GLM-4.7-Flash'); // Default to ModelScope GLM
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
            let body: any = { report_id: reportId };

            if (engine === 'ai') {
                endpoint = '/api/admin/archives/parse-budget-table-ai';
                body.model_config = {
                    provider: 'openai', // Generic
                    apiKey,
                    model,
                    baseUrl: baseUrl || undefined
                };
            }

            const token = localStorage.getItem('auth_token');
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Parse failed');
            }

            const data = await res.json();

            if (data.error === 'NO_SOURCE_TEXT') {
                throw new Error('该文档未提取到文本内容，可能是扫描件或图片PDF。请尝试手动复制文本或使用OCR工具处理后重新上传。');
            }

            setItems(data.items || []);
            setStep('preview');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await onSave(items);
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal title="提取表格数据" isOpen={isOpen} onClose={onClose}>
            <div className="space-y-4">
                {step === 'config' && (
                    <>
                        <div className="flex space-x-4 mb-4">
                            <button
                                className={`flex-1 py-2 px-4 rounded border ${engine === 'local' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-gray-200'}`}
                                onClick={() => setEngine('local')}
                            >
                                本地规则 (正则)
                            </button>
                            <button
                                className={`flex-1 py-2 px-4 rounded border ${engine === 'ai' ? 'bg-purple-50 border-purple-500 text-purple-700' : 'border-gray-200'}`}
                                onClick={() => setEngine('ai')}
                            >
                                AI 增强模式
                            </button>
                        </div>

                        {engine === 'local' && (
                            <div className="bg-gray-50 p-4 rounded text-sm text-gray-600">
                                使用预设的正则表达式从文本中提取 "项目名称 ... 金额" 格式的数据。
                                <br />
                                优点：速度快，免费。
                                <br />
                                缺点：对排版复杂的表格可能识别不全。
                            </div>
                        )}

                        {engine === 'ai' && (
                            <div className="space-y-3 bg-purple-50 p-4 rounded border border-purple-100">
                                <div>
                                    <label className="block text-sm font-medium text-purple-900 mb-1">选择模型</label>
                                    <select
                                        className="w-full border rounded p-2 text-sm"
                                        value={model}
                                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                            const newModel = e.target.value;
                                            setModel(newModel);
                                            // Auto-configure Base URL for known providers
                                            if (newModel.startsWith('ZhipuAI/') || newModel.startsWith('Qwen/') || newModel.startsWith('deepseek-ai/')) {
                                                setBaseUrl('https://api-inference.modelscope.cn/v1/chat/completions');
                                            } else if (newModel === 'qwen-turbo') {
                                                setBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
                                            } else if (newModel === 'deepseek-chat') {
                                                setBaseUrl('https://api.deepseek.com/chat/completions');
                                            }
                                        }}
                                    >
                                        <optgroup label="ModelScope (魔搭社区)">
                                            <option value="ZhipuAI/GLM-4.7-Flash">ZhipuAI/GLM-4.7-Flash</option>
                                            <option value="Qwen/Qwen2.5-72B-Instruct">Qwen/Qwen2.5-72B-Instruct</option>
                                            <option value="deepseek-ai/DeepSeek-V3">deepseek-ai/DeepSeek-V3</option>
                                        </optgroup>
                                        <optgroup label="官方 API">
                                            <option value="deepseek-chat">DeepSeek 官方</option>
                                            <option value="qwen-turbo">通义千问 (阿里云)</option>
                                        </optgroup>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-purple-900 mb-1">API Key</label>
                                    <Input
                                        type="password"
                                        placeholder="sk-..."
                                        value={apiKey}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-purple-900 mb-1">Base URL (已自动填充)</label>
                                    <Input
                                        placeholder="https://..."
                                        value={baseUrl}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-purple-600">
                                    * 自动适配 ModelScope 或官方接口地址。
                                </p>
                            </div>
                        )}

                        {error && (
                            <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
                                错误: {error}
                            </div>
                        )}

                        <div className="flex justify-end pt-4">
                            <Button onClick={handleParse} disabled={isLoading}>
                                {isLoading ? <Spinner size="sm" className="mr-2" /> : null}
                                开始提取
                            </Button>
                        </div>
                    </>
                )}

                {step === 'preview' && (
                    <div className="flex flex-col h-[60vh]">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold">提取结果预览 ({items.length} 条)</h3>
                            <button
                                className="text-sm text-gray-500 hover:text-gray-700"
                                onClick={() => setStep('config')}
                            >
                                重新配置
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto border rounded bg-white">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="p-2 text-left border-b w-2/3">项目名称</th>
                                        <th className="p-2 text-right border-b">金额</th>
                                        <th className="p-2 w-10 border-b"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, idx) => (
                                        <tr key={idx} className="border-b hover:bg-gray-50">
                                            <td className="p-2">
                                                <input
                                                    className="w-full bg-transparent border-none focus:ring-0 p-0"
                                                    value={item.key}
                                                    onChange={(e) => {
                                                        const newItems = [...items];
                                                        newItems[idx].key = e.target.value;
                                                        setItems(newItems);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2 text-right">
                                                <input
                                                    type="number"
                                                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-right"
                                                    value={item.value}
                                                    onChange={(e) => {
                                                        const newItems = [...items];
                                                        newItems[idx].value = parseFloat(e.target.value);
                                                        setItems(newItems);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2 text-center">
                                                <button
                                                    className="text-red-400 hover:text-red-600"
                                                    onClick={() => {
                                                        const newItems = items.filter((_, i) => i !== idx);
                                                        setItems(newItems);
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {items.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="p-8 text-center text-gray-400">
                                                未提取到数据。请尝试更换引擎或手动添加。
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-end pt-4 space-x-2">
                            <Button onClick={() => setStep('config')}>返回</Button>
                            <Button onClick={handleSave} disabled={isLoading || items.length === 0}>
                                {isLoading ? <Spinner size="sm" className="mr-2" /> : null}
                                确认入库
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};
