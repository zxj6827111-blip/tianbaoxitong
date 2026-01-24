import React, { useState } from 'react';
import { apiClient } from '../../utils/apiClient';
import { Download, FileText, FileSpreadsheet, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface ReportGeneratorProps {
  draftId: number;
  fatalCount: number;
  onGenerate?: (reportVersionId: number) => void;
}

export const ReportGenerator: React.FC<ReportGeneratorProps> = ({
  draftId,
  fatalCount,
  onGenerate,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportVersionId, setReportVersionId] = useState<number | null>(null);

  const handleGenerate = async () => {
    if (fatalCount > 0) return;

    try {
      setIsGenerating(true);
      const response = await apiClient.generateReport(draftId);
      setReportVersionId(response.report_version_id);
      onGenerate?.(response.report_version_id);
    } catch (error: any) {
      console.error('Report generation failed:', error);
      const errorMessage = error.response?.data?.message || '生成报告失败,请重试';
      // Consider using a toast here instead of alert in a real app, but sticking to logic prop
      alert(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = fatalCount === 0;

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-6 border border-slate-100">
        <div className="flex items-start gap-4 mb-6">
           <div className={`p-3 rounded-full shrink-0 ${fatalCount > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
              {fatalCount > 0 ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle className="w-6 h-6" />}
           </div>
           <div>
              <h4 className="text-base font-semibold text-slate-900">
                 {fatalCount > 0 ? '无法生成报告' : '准备就绪'}
              </h4>
              <p className="text-sm text-slate-600 mt-1">
                 {fatalCount > 0 
                    ? `当前存在 ${fatalCount} 个严重错误 (FATAL)，请返回"校验"步骤修复。` 
                    : '数据校验通过，您可以生成最终报告。'}
              </p>
           </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating}
          className={`
            w-full py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 font-medium transition-all duration-200
            ${
              canGenerate && !isGenerating
                ? 'bg-brand-600 text-white hover:bg-brand-700 hover:shadow-lg shadow-md active:scale-99'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }
          `}
        >
          {isGenerating ? (
            <>
               <Loader2 className="w-5 h-5 animate-spin" />
               <span>正在生成报告...</span>
            </>
          ) : (
            <>
               <FileText className="w-5 h-5" />
               <span>生成 PDF 报告</span>
            </>
          )}
        </button>
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
                onClick={() => alert('PDF预览功能开发中')}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors font-medium text-sm shadow-sm"
              >
                <FileText className="w-4 h-4" />
                预览 PDF
              </button>
              <button
                onClick={() => alert('Excel下载功能开发中')}
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
