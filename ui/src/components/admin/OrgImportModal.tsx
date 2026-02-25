import React, { useMemo, useState } from 'react';
import { X, Upload, Download, FileSpreadsheet, FileCheck2 } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

interface OrgImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

interface ImportResult {
  success: boolean;
  format?: 'simplified' | 'legacy';
  imported?: {
    departments: number;
    units: number;
  };
  matched?: {
    departments: number;
    units: number;
  };
  errors?: Array<{ row?: number; message?: string }>;
}

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const OrgImportModal: React.FC<OrgImportModalProps> = ({ isOpen, onClose, onImportSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const canUpload = useMemo(() => Boolean(file) && !uploading, [file, uploading]);

  if (!isOpen) return null;

  const resetState = () => {
    setFile(null);
    setUploading(false);
    setDownloadingTemplate(false);
    setError(null);
    setResult(null);
    setDragOver(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileSelected = (nextFile: File | null) => {
    if (!nextFile) return;
    setFile(nextFile);
    setError(null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('请选择 .xlsx 文件');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.importOrgBatch(file);
      setResult(response);
      if (response?.success) {
        onImportSuccess();
      }
    } catch (err: any) {
      const serverMessage = err?.response?.data?.message;
      const detailErrors = err?.response?.data?.details?.errors;
      const detailMessage = Array.isArray(detailErrors)
        ? detailErrors.slice(0, 3).map((item: any) => `第${item.row ?? '-'}行: ${item.message || '数据错误'}`).join('；')
        : null;
      setError(detailMessage || serverMessage || err?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    setError(null);
    try {
      const blob = await apiClient.downloadOrgTemplate();
      triggerBlobDownload(blob, '组织架构导入模板.xlsx');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '模板下载失败');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-100 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">批量导入组织架构</h2>
              <p className="text-xs text-slate-500 mt-0.5">支持简化模板与旧格式（Type/Code/Name）</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 text-sm">先下载模板</h3>
                <p className="text-xs text-blue-700 mt-1">模板列：部门名称 | 单位名称 | 备注</p>
                <button
                  onClick={downloadTemplate}
                  disabled={downloadingTemplate}
                  className="mt-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {downloadingTemplate ? '下载中...' : '下载 XLSX 模板'}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">上传文件</label>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const dropped = event.dataTransfer.files?.[0] || null;
                handleFileSelected(dropped);
              }}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400'}`}
            >
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <input
                type="file"
                accept=".xlsx"
                onChange={(event) => handleFileSelected(event.target.files?.[0] || null)}
                className="hidden"
                id="org-file-upload"
              />
              <label htmlFor="org-file-upload" className="cursor-pointer text-sm text-brand-600 hover:text-brand-700 font-medium">
                点击选择 .xlsx 文件
              </label>
              <p className="text-xs text-slate-500 mt-1">或将文件拖拽到此处</p>
              {file && (
                <div className="mt-3 text-sm text-slate-600">
                  已选择: <span className="font-medium">{file.name}</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
              {error}
            </div>
          )}

          {result?.success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-semibold text-green-900 text-sm mb-2 flex items-center gap-2">
                <FileCheck2 className="w-4 h-4" />
                导入完成
              </h3>
              <div className="text-xs text-green-700 space-y-1">
                <p>识别格式: {result.format === 'simplified' ? '简化模板' : '旧格式'}</p>
                <p>新增部门: {result.imported?.departments || 0}</p>
                <p>新增单位: {result.imported?.units || 0}</p>
                <p>命中现有部门: {result.matched?.departments || 0}</p>
                <p>命中现有单位: {result.matched?.units || 0}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            关闭
          </button>
          <button
            onClick={handleUpload}
            disabled={!canUpload}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? '导入中...' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrgImportModal;
