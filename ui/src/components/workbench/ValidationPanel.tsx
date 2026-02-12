import React, { useState, useEffect } from 'react';
import { apiClient } from '../../utils/apiClient';

interface ValidationIssue {
  id: number;
  level: 'FATAL' | 'WARNING' | 'SUGGEST';
  rule_id: string;
  message: string;
  evidence?: {
    sheet_name?: string;
    cell_address?: string;
    anchor?: string;
    item_key?: string;
    missing_keys?: Array<{ key: string }>;
    [key: string]: any;
  };
}

interface ValidationPanelProps {
  draftId: string;
  ifMatchUpdatedAt?: string | null;
  onValidate?: () => void;
  onValidated?: (result: any) => void;
  onIssuesChange?: (issues: ValidationIssue[]) => void;
  onIssueClick?: (issue: ValidationIssue) => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({ draftId, ifMatchUpdatedAt, onValidate, onValidated, onIssuesChange, onIssueClick }) => {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'FATAL' | 'WARNING' | 'SUGGEST'>('all');

  const loadIssues = async (level?: string) => {
    try {
      const response = await apiClient.getIssues(draftId, level);
      const nextIssues = response.issues || [];
      setIssues(nextIssues);
      onIssuesChange?.(nextIssues);
    } catch (error) {
      console.error('Failed to load issues:', error);
    }
  };

  useEffect(() => {
    loadIssues();
  }, [draftId]);

  const handleValidate = async () => {
    try {
      setIsValidating(true);
      const response = await apiClient.validateDraft(draftId, {
        if_match_updated_at: ifMatchUpdatedAt || undefined
      });
      const nextIssues = response.issues || [];
      setIssues(nextIssues);
      onIssuesChange?.(nextIssues);
      onValidated?.(response);
      onValidate?.();
    } catch (error) {
      console.error('Validation failed:', error);
      alert('校验失败，可能是草稿已被更新，请刷新后重试');
    } finally {
      setIsValidating(false);
    }
  };

  const filteredIssues = filter === 'all' ? issues : issues.filter((i) => i.level === filter);

  const fatalCount = issues.filter((i) => i.level === 'FATAL').length;
  const warningCount = issues.filter((i) => i.level === 'WARNING').length;
  const suggestCount = issues.filter((i) => i.level === 'SUGGEST').length;

  const getLevelBadge = (level: string) => {
    const badges = {
      FATAL: 'bg-red-100 text-red-800 border-red-300',
      WARNING: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      SUGGEST: 'bg-blue-100 text-blue-800 border-blue-300',
    };
    return badges[level as keyof typeof badges] || 'bg-gray-100 text-gray-800';
  };

  const getLevelIcon = (level: string) => {
    const icons = {
      FATAL: '🚫',
      WARNING: '⚠️',
      SUGGEST: '💡',
    };
    return icons[level as keyof typeof icons] || '📝';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">校验结果</h3>
        <button
          onClick={handleValidate}
          disabled={isValidating}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-400"
        >
          {isValidating ? '校验中...' : '重新校验'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div
          className={`p-4 rounded-lg border-2 cursor-pointer ${
            filter === 'FATAL' ? 'border-red-500 bg-red-50' : 'border-gray-200'
          }`}
          onClick={() => setFilter(filter === 'FATAL' ? 'all' : 'FATAL')}
        >
          <div className="text-sm text-gray-600">Fatal 错误</div>
          <div className="text-2xl font-bold text-red-600">{fatalCount}</div>
          <div className="text-xs text-gray-500 mt-1">禁止生成</div>
        </div>
        <div
          className={`p-4 rounded-lg border-2 cursor-pointer ${
            filter === 'WARNING' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200'
          }`}
          onClick={() => setFilter(filter === 'WARNING' ? 'all' : 'WARNING')}
        >
          <div className="text-sm text-gray-600">Warning 警告</div>
          <div className="text-2xl font-bold text-yellow-600">{warningCount}</div>
          <div className="text-xs text-gray-500 mt-1">建议修复</div>
        </div>
        <div
          className={`p-4 rounded-lg border-2 cursor-pointer ${
            filter === 'SUGGEST' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
          }`}
          onClick={() => setFilter(filter === 'SUGGEST' ? 'all' : 'SUGGEST')}
        >
          <div className="text-sm text-gray-600">Suggest 建议</div>
          <div className="text-2xl font-bold text-blue-600">{suggestCount}</div>
          <div className="text-xs text-gray-500 mt-1">可选优化</div>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredIssues.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {issues.length === 0 ? '暂无校验问题' : '该级别无问题'}
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <div
              key={issue.id}
              className={`p-4 border rounded-lg ${getLevelBadge(issue.level)} ${onIssueClick ? 'cursor-pointer hover:shadow-sm' : ''}`}
              onClick={() => onIssueClick?.(issue)}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl">{getLevelIcon(issue.level)}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs font-semibold rounded border">
                      {issue.level}
                    </span>
                    <span className="text-xs text-gray-600">{issue.rule_id}</span>
                  </div>
                  <p className="text-sm font-medium">{issue.message}</p>
                  {issue.evidence && (
                    <div className="mt-2 text-xs text-gray-600">
                      {issue.evidence.sheet_name && (
                        <span>表: {issue.evidence.sheet_name}</span>
                      )}
                      {issue.evidence.cell_address && (
                        <span className="ml-2">单元格: {issue.evidence.cell_address}</span>
                      )}
                      {issue.evidence.anchor && (
                        <span className="ml-2">锚点: {issue.evidence.anchor}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {fatalCount > 0 && (
        <div className="p-4 bg-red-50 border border-red-300 rounded-lg">
          <p className="text-sm text-red-800">
            ⚠️ 存在 {fatalCount} 个 Fatal 错误,必须修复后才能生成报告
          </p>
        </div>
      )}
    </div>
  );
};
