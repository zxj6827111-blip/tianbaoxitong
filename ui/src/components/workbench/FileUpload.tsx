import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { apiClient } from '../../utils/apiClient';
import { Loading } from '../ui/Loading';

interface FileUploadProps {
  onUploadComplete: (draftId: number) => void;
  onError: (error: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUploadComplete, onError }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [caliber, setCaliber] = useState<'unit' | 'department'>('unit');

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      
      if (!file.name.endsWith('.xlsx')) {
        onError('只支持 .xlsx 格式的Excel文件');
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);

      try {
        // 模拟上传进度
        setUploadProgress(30);

        // 上传文件
        const uploadResponse = await apiClient.uploadFile(file, year, caliber);
        setUploadProgress(60);

        // 解析文件
        const parseResponse = await apiClient.parseUpload(uploadResponse.upload_id);
        setUploadProgress(100);

        // 通知完成
        setTimeout(() => {
          onUploadComplete(parseResponse.draft_id);
          setIsUploading(false);
          setUploadProgress(0);
        }, 500);
      } catch (err: any) {
        console.error('Upload error:', err);
        const errorMessage = err.response?.data?.message || '上传失败,请重试';
        onError(errorMessage);
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [year, caliber, onUploadComplete, onError]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    multiple: false,
    disabled: isUploading,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">年度</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isUploading}
            min={2020}
            max={2030}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">口径</label>
          <select
            value={caliber}
            onChange={(e) => setCaliber(e.target.value as 'unit' | 'department')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isUploading}
          >
            <option value="unit">单位口径</option>
            <option value="department">部门口径</option>
          </select>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="space-y-2">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isDragActive ? (
            <p className="text-blue-600 font-medium">释放以上传文件</p>
          ) : (
            <>
              <p className="text-gray-600">拖拽Excel文件到此处,或点击选择文件</p>
              <p className="text-sm text-gray-500">仅支持 .xlsx 格式</p>
            </>
          )}
        </div>
      </div>

      {isUploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>上传并解析中...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
};
