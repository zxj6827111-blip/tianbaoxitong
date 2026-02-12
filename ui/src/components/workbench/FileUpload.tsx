import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { apiClient } from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';

interface FileUploadProps {
  onUploadComplete: (draftId: string) => void;
  onError: (error: string) => void;
}

interface Unit {
  id: string;
  name: string;
  department_name?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUploadComplete, onError }) => {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [caliber, setCaliber] = useState<'unit' | 'department'>('unit');
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [loadingUnits, setLoadingUnits] = useState(false);

  // Check if user is admin (needs to select a unit)
  const isAdmin = user?.role === 'admin' || user?.roles?.includes('admin');
  const userHasNoUnit = !user?.unit_id;

  // Load units for admin users or users without assigned unit
  useEffect(() => {
    if (isAdmin || userHasNoUnit) {
      setLoadingUnits(true);
      apiClient.getUnits({ pageSize: 1000 })
        .then((response) => {
          setUnits(response.units || []);
          // Auto-select first unit if available
          if (response.units?.length > 0 && !selectedUnitId) {
            setSelectedUnitId(response.units[0].id);
          }
        })
        .catch((err) => {
          console.error('Failed to load units:', err);
        })
        .finally(() => {
          setLoadingUnits(false);
        });
    }
  }, [isAdmin, userHasNoUnit]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];

      const lowerName = file.name.toLowerCase();
      if (!(lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls'))) {
        onError('只支持 .xls/.xlsx 格式的Excel文件');
        return;
      }

      // Validate unit selection for admin users
      if ((isAdmin || userHasNoUnit) && !selectedUnitId) {
        onError('请先选择一个单位');
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);

      try {
        // 模拟上传进度
        setUploadProgress(30);

        // 上传文件 - pass unitId for admin users
        const unitIdToUse = (isAdmin || userHasNoUnit) ? selectedUnitId : undefined;
        const uploadResponse = await apiClient.uploadFile(file, year, caliber, unitIdToUse);
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
    [year, caliber, selectedUnitId, isAdmin, userHasNoUnit, onUploadComplete, onError]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
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

      {/* Unit selector for admin users or users without assigned unit */}
      {(isAdmin || userHasNoUnit) && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            选择单位 <span className="text-red-500">*</span>
          </label>
          {loadingUnits ? (
            <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
              加载单位列表中...
            </div>
          ) : units.length === 0 ? (
            <div className="w-full px-3 py-3 border border-amber-300 rounded-md bg-amber-50 text-amber-700 text-sm">
              <p className="font-medium">暂无可用单位</p>
              <p className="text-xs mt-1">请先在管理后台创建单位后再上传文件</p>
            </div>
          ) : (
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isUploading}
            >
              <option value="">-- 请选择单位 --</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} {unit.department_name ? `(${unit.department_name})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

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
              <p className="text-sm text-gray-500">仅支持 .xls/.xlsx 格式</p>
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
