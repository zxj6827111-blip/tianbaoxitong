import React, { useState } from 'react';
import { apiClient } from '../../utils/apiClient';
import { FileText, FileSpreadsheet, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface ReportGeneratorProps {
  draftId: string;
  fatalCount: number;
  ifMatchUpdatedAt?: string | null;
  canGenerate?: boolean;
  onGenerate?: (reportVersionId: number, payload?: any) => void;
}

export const ReportGenerator: React.FC<ReportGeneratorProps> = ({
  draftId,
  fatalCount,
  ifMatchUpdatedAt,
  canGenerate = true,
  onGenerate,
}) => {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<{ page_count: number; blank_pages: number[] } | null>(null);
  const [previewErrorText, setPreviewErrorText] = useState<string | null>(null);
  const [reportVersionId, setReportVersionId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handlePreview = async () => {
    if (fatalCount > 0) return;

    try {
      setIsPreviewing(true);
      setPreviewErrorText(null);
      setErrorText(null);
      const response = await apiClient.generateReportPreview(draftId, {
        if_match_updated_at: ifMatchUpdatedAt || undefined
      });
      setPreviewReady(true);
      setPreviewInfo(response?.preflight || null);
    } catch (error: any) {
      console.error('Report preview generation failed:', error);
      const backendMessage = error?.response?.data?.message;
      const fallbackMessage = typeof error?.message === 'string' ? error.message : '';
      setPreviewReady(false);
      setPreviewInfo(null);
      setPreviewErrorText(backendMessage || fallbackMessage || '生成预览失败，请重试');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleGenerate = async () => {
    if (fatalCount > 0) return;
    if (!previewReady) {
      setErrorText('请先生成并检查预览PDF，再确认发布正式报告。');
      return;
    }

    try {
      setIsGenerating(true);
      setErrorText(null);
      const response = await apiClient.generateReport(draftId, {
        if_match_updated_at: ifMatchUpdatedAt || undefined
      });
      setReportVersionId(response.report_version_id);
      onGenerate?.(response.report_version_id, response);
    } catch (error: any) {
      console.error('Report generation failed:', error);
      const code = error?.response?.data?.code || error?.code;
      const backendMessage = error?.response?.data?.message;
      const fallbackMessage = typeof error?.message === 'string' ? error.message : '';
      if (code === 'ECONNABORTED' || /timeout/i.test(fallbackMessage)) {
        setErrorText('生成请求超时（前端等待过久）。后端可能仍在继续生成，请稍后刷新本页查看最新状态。');
      } else if (code === 'PREVIEW_REQUIRED') {
        setErrorText('请先点击“生成预览PDF”，确认格式后再发布正式报告。');
      } else {
        setErrorText(backendMessage || fallbackMessage || '生成报告失败，请重试');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerateNow = canGenerate && fatalCount === 0;
  const blockedBySubmit = !canGenerate && fatalCount === 0;
  const waitingPreview = canGenerateNow && !previewReady;
  const canPublishNow = canGenerateNow && previewReady;

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-6 border border-slate-100">
        <div className="flex items-start gap-4 mb-6">
          <div className={`p-3 rounded-full shrink-0 ${fatalCount > 0 || blockedBySubmit ? 'bg-red-100 text-red-600' : waitingPreview ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
            {fatalCount > 0 || blockedBySubmit ? <AlertTriangle className="w-6 h-6" /> : waitingPreview ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle className="w-6 h-6" />}
          </div>
          <div>
            <h4 className="text-base font-semibold text-slate-900">
              {fatalCount > 0 ? '无法生成报告' : blockedBySubmit ? '请先提交填报' : waitingPreview ? '请先生成预览' : '可发布正式报告'}
            </h4>
            <p className="text-sm text-slate-600 mt-1">
              {fatalCount > 0
                ? `当前存在 ${fatalCount} 个严重错误 (FATAL)，请返回"校验"步骤修复。`
                : blockedBySubmit
                  ? '请先在“总览与提交”中完成提交，再生成正式报告。'
                  : waitingPreview
                    ? '请先生成并检查预览PDF，确认格式后再发布正式报告。'
                    : '预览已通过，您可以发布正式报告。'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={handlePreview}
            disabled={!canGenerateNow || isPreviewing || isGenerating}
            className={`
              py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-medium transition-all duration-200
              ${canGenerateNow && !isPreviewing && !isGenerating
                ? 'bg-white text-brand-700 border border-brand-200 hover:bg-brand-50'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }
            `}
          >
            {isPreviewing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>正在生成预览...</span>
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                <span>{previewReady ? '重新生成预览PDF' : '生成预览PDF'}</span>
              </>
            )}
          </button>

          <button
            onClick={async () => {
              try {
                await apiClient.downloadDraftPreviewPdf(draftId);
              } catch (error) {
                console.error('Preview PDF download failed:', error);
                alert('预览PDF下载失败，请重试');
              }
            }}
            disabled={!previewReady || isPreviewing || isGenerating}
            className={`
              py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-medium transition-all duration-200
              ${previewReady && !isPreviewing && !isGenerating
                ? 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-50'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }
            `}
          >
            <FileText className="w-5 h-5" />
            <span>下载预览PDF</span>
          </button>
        </div>

        {previewInfo ? (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            预检通过：共 {previewInfo.page_count} 页，空白页 {previewInfo.blank_pages.length} 页。
          </div>
        ) : null}

        <button
          onClick={handleGenerate}
          disabled={!canPublishNow || isGenerating || isPreviewing}
          className={`
            mt-3 w-full py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 font-medium transition-all duration-200
            ${canPublishNow && !isGenerating && !isPreviewing
              ? 'bg-brand-600 text-white hover:bg-brand-700 hover:shadow-lg shadow-md active:scale-99'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }
          `}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>正在发布正式报告...</span>
            </>
          ) : (
            <>
              <FileText className="w-5 h-5" />
              <span>确认发布正式报告</span>
            </>
          )}
        </button>

        {previewErrorText ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {previewErrorText}
          </div>
        ) : null}
        {errorText ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorText}
          </div>
        ) : null}
      </div>

      {reportVersionId && (
        <div className="animate-fade-in bg-blue-50 border border-blue-200 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-blue-600" />
              <h4 className="font-semibold text-blue-900">报告生成成功</h4>
            </div>
            <p className="text-sm text-blue-700 mb-6">
              版本 ID: <span className="font-mono font-medium">{reportVersionId}</span>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={async () => {
                  try {
                    await apiClient.downloadPdf(reportVersionId);
                  } catch (error) {
                    console.error('PDF download failed:', error);
                    alert('PDF下载失败,请重试');
                  }
                }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors font-medium text-sm shadow-sm"
              >
                <FileText className="w-4 h-4" />
                预览 PDF
              </button>
              <button
                onClick={async () => {
                  try {
                    await apiClient.downloadExcel(reportVersionId);
                  } catch (error) {
                    console.error('Excel download failed:', error);
                    alert('Excel下载失败,请重试');
                  }
                }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-green-700 border border-green-200 rounded-lg hover:bg-green-50 transition-colors font-medium text-sm shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4" />
                下载结果 Excel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
