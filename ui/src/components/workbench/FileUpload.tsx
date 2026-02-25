import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
  department_id?: string | null;
  department_name?: string | null;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface SearchableOption {
  id: string;
  label: string;
  keywords?: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableOption[];
  onChange: (nextValue: string) => void;
  placeholder: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  allowEmpty = false,
  emptyLabel = '清空选择'
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = useMemo(
    () => options.find((option) => option.id === value)?.label || '',
    [options, value]
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) =>
      `${option.label} ${option.keywords || ''}`.toLowerCase().includes(keyword)
    );
  }, [options, query]);

  const applySelection = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={open ? query : selectedLabel}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery('');
        }}
        onChange={(event) => {
          if (disabled) return;
          setOpen(true);
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (filteredOptions.length > 0) {
              applySelection(filteredOptions[0].id);
            } else if (allowEmpty) {
              applySelection('');
            }
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      />
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {allowEmpty && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySelection('')}
              className="block w-full px-3 py-2 text-left text-xs text-gray-600 hover:bg-gray-50 border-b border-gray-100"
            >
              {emptyLabel}
            </button>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">无匹配结果</div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySelection(option.id)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                  option.id === value ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export const FileUpload: React.FC<FileUploadProps> = ({ onUploadComplete, onError }) => {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [units, setUnits] = useState<Unit[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [loadingUnits, setLoadingUnits] = useState(false);

  const isAdminLike = user?.role === 'admin'
    || user?.role === 'maintainer'
    || user?.roles?.includes('admin')
    || user?.roles?.includes('maintainer');
  const managedUnitIds = useMemo(
    () => (Array.isArray(user?.managed_unit_ids) ? user.managed_unit_ids.map((value) => String(value)) : []),
    [user?.managed_unit_ids]
  );
  const userHasNoUnit = !user?.unit_id;
  const hasBudgetCreatePermission = user?.can_create_budget !== false;
  const hasMultipleManagedUnits = managedUnitIds.length > 1;
  const needsScopeSelection = isAdminLike || userHasNoUnit || hasMultipleManagedUnits;

  const unitsInSelectedDepartment = useMemo(
    () => units.filter((unit) => String(unit.department_id || '') === selectedDepartmentId),
    [units, selectedDepartmentId]
  );

  useEffect(() => {
    if (!needsScopeSelection) return;

    const loadScopeOptions = async () => {
      setLoadingUnits(true);
      try {
        const scopeResponse = await apiClient.getUploadScopeOptions();
        const loadedUnits: Unit[] = Array.isArray(scopeResponse?.units)
          ? scopeResponse.units.map((unit: any) => ({
              id: String(unit?.id || '').trim(),
              name: String(unit?.name || '').trim(),
              department_id: unit?.department_id ? String(unit.department_id).trim() : null,
              department_name: unit?.department_name ? String(unit.department_name).trim() : null
            })).filter((unit) => unit.id)
          : [];
        const loadedDepartments: DepartmentOption[] = Array.isArray(scopeResponse?.departments)
          ? scopeResponse.departments.map((department: any) => ({
              id: String(department?.id || '').trim(),
              name: String(department?.name || '').trim()
            })).filter((department) => department.id)
          : [];

        setUnits(loadedUnits);
        setDepartments(loadedDepartments);

        const defaultDepartmentId = String(scopeResponse?.default_department_id || '').trim();
        const defaultUnitId = String(scopeResponse?.default_unit_id || '').trim();

        setSelectedDepartmentId((prev) => {
          if (prev && loadedDepartments.some((department) => department.id === prev)) {
            return prev;
          }
          if (defaultDepartmentId && loadedDepartments.some((department) => department.id === defaultDepartmentId)) {
            return defaultDepartmentId;
          }
          if (loadedDepartments.length === 1) {
            return loadedDepartments[0].id;
          }
          return '';
        });

        setSelectedUnitId((prev) => {
          if (prev && loadedUnits.some((unit) => unit.id === prev)) {
            return prev;
          }
          if (defaultUnitId && loadedUnits.some((unit) => unit.id === defaultUnitId)) {
            return defaultUnitId;
          }
          if (loadedUnits.length === 1) {
            return loadedUnits[0].id;
          }
          return '';
        });
      } catch (err) {
        console.error('Failed to load scope options:', err);
        setUnits([]);
        setDepartments([]);
        setSelectedDepartmentId('');
        setSelectedUnitId('');
      } finally {
        setLoadingUnits(false);
      }
    };

    void loadScopeOptions();
  }, [needsScopeSelection, user?.id, user?.department_id, user?.unit_id, managedUnitIds.join(',')]);

  useEffect(() => {
    if (!needsScopeSelection) return;
    if (!selectedDepartmentId) {
      if (selectedUnitId) {
        setSelectedUnitId('');
      }
      return;
    }

    const stillValid = unitsInSelectedDepartment.some((unit) => unit.id === selectedUnitId);
    if (!stillValid && selectedUnitId) {
      setSelectedUnitId('');
    }
  }, [needsScopeSelection, selectedDepartmentId, selectedUnitId, unitsInSelectedDepartment]);

  useEffect(() => {
    if (!needsScopeSelection || !selectedDepartmentId) return;
    if (!departments.some((department) => department.id === selectedDepartmentId)) {
      setSelectedDepartmentId('');
      setSelectedUnitId('');
    }
  }, [needsScopeSelection, departments, selectedDepartmentId]);

  const extractApiErrorMessage = (error: any, fallback: string) => {
    const responseData = error?.response?.data;
    const responseMessage = typeof responseData?.message === 'string'
      ? responseData.message.trim()
      : '';
    const responseCode = typeof responseData?.code === 'string'
      ? responseData.code.trim()
      : '';
    const requestId = typeof responseData?.request_id === 'string'
      ? responseData.request_id.trim()
      : '';

    if (responseMessage) {
      return requestId ? `${responseMessage}（请求ID: ${requestId}）` : responseMessage;
    }

    if (typeof responseData === 'string' && responseData.trim()) {
      return responseData.trim();
    }

    const errorCode = String(error?.code || '').toUpperCase();
    const errorMessage = String(error?.message || '').toLowerCase();
    if (errorCode === 'ECONNABORTED' || errorMessage.includes('timeout')) {
      return `${fallback}（请求超时，请稍后重试）`;
    }

    if (!error?.response || errorMessage.includes('network error')) {
      return `${fallback}（网络异常，请检查后端服务）`;
    }

    if (responseCode) {
      return `${fallback}（${responseCode}）`;
    }

    return fallback;
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      if (!hasBudgetCreatePermission) {
        onError('当前账号没有预算报告创建权限');
        return;
      }

      const file = acceptedFiles[0];
      const lowerName = file.name.toLowerCase();
      if (!(lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls'))) {
        onError('只支持 .xls/.xlsx 格式的Excel文件');
        return;
      }

      if (needsScopeSelection && !selectedDepartmentId) {
        onError('请先选择部门');
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);
      setUploadProgress(30);

      const unitIdToUse = needsScopeSelection ? selectedUnitId : undefined;
      const departmentIdToUse = needsScopeSelection ? selectedDepartmentId : undefined;

      let uploadResponse: any;
      try {
        uploadResponse = await apiClient.uploadFile(file, year, unitIdToUse, departmentIdToUse);
      } catch (uploadError: any) {
        console.error('Upload request failed:', uploadError);
        onError(extractApiErrorMessage(uploadError, '上传失败,请重试'));
        setIsUploading(false);
        setUploadProgress(0);
        return;
      }

      setUploadProgress(60);

      try {
        const parseResponse = await apiClient.parseUpload(uploadResponse.upload_id);
        setUploadProgress(100);
        setTimeout(() => {
          onUploadComplete(parseResponse.draft_id);
          setIsUploading(false);
          setUploadProgress(0);
        }, 500);
      } catch (parseError: any) {
        console.error('Parse request failed:', parseError);
        const parseMessage = extractApiErrorMessage(parseError, '解析失败,请重试');
        onError(`上传成功，但解析失败：${parseMessage}`);
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [
      year,
      selectedDepartmentId,
      selectedUnitId,
      needsScopeSelection,
      hasBudgetCreatePermission,
      onUploadComplete,
      onError
    ]
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

      {needsScopeSelection && (
        <div className="space-y-4">
          {loadingUnits ? (
            <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
              加载部门和单位列表中...
            </div>
          ) : units.length === 0 ? (
            <div className="w-full px-3 py-3 border border-amber-300 rounded-md bg-amber-50 text-amber-700 text-sm">
              <p className="font-medium">暂无可用单位</p>
              <p className="text-xs mt-1">请先在管理后台创建部门和单位后再上传文件</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择部门 <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  value={selectedDepartmentId}
                  options={departments.map((department) => ({
                    id: department.id,
                    label: department.name
                  }))}
                  onChange={(departmentId) => {
                    setSelectedDepartmentId(departmentId);
                    setSelectedUnitId('');
                  }}
                  placeholder="输入部门名称模糊搜索"
                  disabled={isUploading}
                  allowEmpty
                  emptyLabel="清空部门选择"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">选择单位（可选）</label>
                <SearchableSelect
                  value={selectedUnitId}
                  options={unitsInSelectedDepartment.map((unit) => ({
                    id: unit.id,
                    label: unit.name,
                    keywords: `${unit.department_name || ''}`
                  }))}
                  onChange={(unitId) => setSelectedUnitId(unitId)}
                  placeholder={selectedDepartmentId ? '输入单位名称模糊搜索（可留空）' : '请先选择部门'}
                  disabled={isUploading || !selectedDepartmentId}
                  allowEmpty
                  emptyLabel="不选择单位（按部门口径）"
                />
              </div>

              {selectedDepartmentId && !selectedUnitId && (
                <div className="w-full px-3 py-2 border border-blue-200 rounded-md bg-blue-50 text-blue-700 text-xs">
                  当前未选择单位，将按部门口径自动匹配模板并开始填报。
                </div>
              )}

              {selectedDepartmentId && unitsInSelectedDepartment.length === 0 && (
                <div className="w-full px-3 py-2 border border-amber-300 rounded-md bg-amber-50 text-amber-700 text-xs">
                  当前部门下暂无单位，请先在管理后台补充单位。
                </div>
              )}
            </>
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
