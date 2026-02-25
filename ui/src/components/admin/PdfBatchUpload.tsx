import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, FileText, PlayCircle, RefreshCcw, Trash2 } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

interface UnitOption {
  id: string;
  name: string;
  code: string;
  department_id: string | null;
  department_name: string | null;
}

interface UploadRow {
  temp_id: string;
  file_name: string;
  size: number;
  detected_unit_name: string | null;
  detected_year: number | null;
  detected_scope: 'DEPARTMENT' | 'UNIT' | null;
  department_id: string;
  match_status: 'exact' | 'fuzzy' | 'none';
  confidence: number;
  matched_unit: UnitOption | null;
  warning?: string | null;
  unit_id: string;
  year: string;
  process_status?: 'idle' | 'success' | 'failed' | 'skipped';
  process_message?: string | null;
}

interface PdfBatchUploadProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DepartmentOption {
  id: string;
  name: string;
  units: UnitOption[];
  default_unit_id: string;
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
  emptyLabel = '不选择'
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
    return options.filter((option) => `${option.label} ${option.keywords || ''}`.toLowerCase().includes(keyword));
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
        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400"
      />
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {allowEmpty && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySelection('')}
              className="block w-full px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50 border-b border-slate-100"
            >
              {emptyLabel}
            </button>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-2 text-xs text-slate-400">无匹配项</div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySelection(option.id)}
                className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
                  option.id === value ? 'bg-brand-50 text-brand-700' : 'text-slate-700'
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

const formatSize = (size: number) => {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

const buildFileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const normalizeToken = (value: string) => String(value || '').replace(/[\s（）()【】\[\]《》·,，.。]/g, '').toLowerCase();
const normalizeDetectedScope = (scope: unknown): UploadRow['detected_scope'] => {
  const normalized = String(scope || '').toUpperCase();
  if (normalized === 'DEPARTMENT') return 'DEPARTMENT';
  if (normalized === 'UNIT') return 'UNIT';
  return null;
};

const pickDepartmentDefaultUnitId = (departmentName: string, units: UnitOption[]) => {
  if (units.length === 0) return '';
  const normalizedDepartmentName = normalizeToken(departmentName);
  const exact = units.find((unit) => normalizeToken(unit.name) === normalizedDepartmentName);
  if (exact) return exact.id;

  const nativeDept = units.find((unit) => /本级|机关/.test(unit.name));
  if (nativeDept) return nativeDept.id;

  return units[0].id;
};

const baseApiUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const PdfBatchUpload: React.FC<PdfBatchUploadProps> = ({ isOpen, onClose }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchToken, setBatchToken] = useState<string | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [removedTempIds, setRemovedTempIds] = useState<string[]>([]);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [summary, setSummary] = useState<{ success: number; failed: number; skipped: number } | null>(null);

  const departmentOptions = useMemo<DepartmentOption[]>(() => {
    const grouped = new Map<string, DepartmentOption>();
    unitOptions.forEach((unit) => {
      const departmentId = String(unit.department_id || '');
      const departmentName = unit.department_name || '未分组部门';
      if (!departmentId) return;
      const existing = grouped.get(departmentId);
      if (existing) {
        existing.units.push(unit);
      } else {
        grouped.set(departmentId, {
          id: departmentId,
          name: departmentName,
          units: [unit],
          default_unit_id: ''
        });
      }
    });

    const departments = Array.from(grouped.values())
      .map((department) => ({
        ...department,
        units: department.units.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
        default_unit_id: pickDepartmentDefaultUnitId(department.name, department.units)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    return departments;
  }, [unitOptions]);

  const departmentById = useMemo(
    () => new Map(departmentOptions.map((department) => [department.id, department])),
    [departmentOptions]
  );

  const unitById = useMemo(
    () => new Map(unitOptions.map((unit) => [unit.id, unit])),
    [unitOptions]
  );

  const canUpload = useMemo(() => files.length > 0 && !uploading && !processing, [files, uploading, processing]);
  const canProcess = useMemo(
    () => Boolean(batchToken) && (rows.length > 0 || removedTempIds.length > 0) && !uploading && !processing,
    [batchToken, rows.length, removedTempIds.length, uploading, processing]
  );

  if (!isOpen) return null;

  const resetAll = () => {
    setFiles([]);
    setDragOver(false);
    setUploading(false);
    setProcessing(false);
    setError(null);
    setBatchToken(null);
    setRows([]);
    setRemovedTempIds([]);
    setUnitOptions([]);
    setSummary(null);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const appendFiles = (nextFiles: FileList | File[]) => {
    const selected = Array.from(nextFiles || []).filter((file) => /\.pdf$/i.test(file.name));
    if (selected.length === 0) return;
    setFiles((prev) => {
      const dedup = new Map<string, File>();
      [...prev, ...selected].forEach((file) => dedup.set(buildFileKey(file), file));
      return Array.from(dedup.values());
    });
    setError(null);
  };

  const uploadForPreview = async () => {
    if (!canUpload) return;
    setUploading(true);
    setError(null);
    setSummary(null);
    try {
      const payload = await apiClient.uploadPdfBatch(files);
      setBatchToken(payload.batch_token);
      setUnitOptions(Array.isArray(payload.unit_options) ? payload.unit_options : []);
      setRemovedTempIds([]);
      const normalizedRows: UploadRow[] = (payload.items || []).map((item: any) => {
        const detectedScope = normalizeDetectedScope(item.detected_scope);
        const isDepartmentDetected = detectedScope === 'DEPARTMENT' || item.unit_source === 'cover_department_label';
        return {
          temp_id: item.temp_id,
          file_name: item.file_name,
          size: Number(item.size || 0),
          detected_unit_name: item.detected_unit_name || null,
          detected_year: item.detected_year ? Number(item.detected_year) : null,
          detected_scope: detectedScope,
          department_id: item.matched_unit?.department_id || '',
          match_status: item.match_status || 'none',
          confidence: Number(item.confidence || 0),
          matched_unit: item.matched_unit || null,
          warning: item.warning || null,
          unit_id: isDepartmentDetected ? '' : (item.matched_unit?.id || ''),
          year: item.detected_year ? String(item.detected_year) : '',
          process_status: 'idle',
          process_message: null
        };
      });
      setRows(normalizedRows);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '上传识别失败');
    } finally {
      setUploading(false);
    }
  };

  const updateRow = (tempId: string, patch: Partial<UploadRow>) => {
    setRows((prev) => prev.map((row) => (row.temp_id === tempId ? { ...row, ...patch } : row)));
  };

  const updateRowDepartment = (tempId: string, departmentId: string) => {
    setRows((prev) => prev.map((row) => {
      if (row.temp_id !== tempId) return row;
      if (!departmentId) {
        return {
          ...row,
          department_id: '',
          unit_id: ''
        };
      }
      const department = departmentById.get(departmentId);
      const currentUnitStillValid = row.unit_id
        ? Boolean(department?.units.some((unit) => unit.id === row.unit_id))
        : false;

      return {
        ...row,
        department_id: departmentId,
        unit_id: currentUnitStillValid ? row.unit_id : ''
      };
    }));
  };

  const resolveUnitIdForRow = (row: UploadRow) => {
    if (row.unit_id) return row.unit_id;
    return '';
  };

  const resolveDepartmentIdForRow = (row: UploadRow) => {
    if (row.department_id) return row.department_id;
    if (row.unit_id) return String(unitById.get(row.unit_id)?.department_id || '');
    return '';
  };

  const resolveScopeForRow = (row: UploadRow): UploadRow['detected_scope'] => {
    if (row.unit_id) return 'UNIT';
    if (row.department_id) return 'DEPARTMENT';
    return row.detected_scope;
  };

  const resolveTargetLabelForRow = (row: UploadRow) => {
    if (row.unit_id) {
      return unitById.get(row.unit_id)?.name || '已选单位';
    }
    if (row.department_id) {
      const department = departmentById.get(row.department_id);
      return department ? `${department.name}（部门口径）` : '部门口径';
    }
    return '未选择';
  };

  const removeRow = (tempId: string) => {
    setRows((prev) => prev.filter((row) => row.temp_id !== tempId));
    setRemovedTempIds((prev) => (prev.includes(tempId) ? prev : [...prev, tempId]));
  };

  const processBatch = async () => {
    if (!canProcess || !batchToken) return;
    setProcessing(true);
    setError(null);
    setSummary(null);

    const payloadItems = rows.map((row) => ({
      temp_id: row.temp_id,
      unit_id: resolveUnitIdForRow(row) || null,
      department_id: resolveDepartmentIdForRow(row) || null,
      scope: resolveScopeForRow(row),
      year: row.year ? Number(row.year) : null
    })).concat(
      removedTempIds.map((tempId) => ({
        temp_id: tempId,
        skip: true
      }))
    );

    try {
      const token = localStorage.getItem('auth_token');
      const endpoint = `${baseApiUrl}/api/admin/pdf-batch/process`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify({
          batch_token: batchToken,
          items: payloadItems
        })
      });

      if (!response.ok) {
        let errorMessage = `处理失败 (${response.status})`;
        try {
          const payload = await response.json();
          errorMessage = payload?.message || errorMessage;
        } catch {
          // Ignore JSON parse failure.
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取处理进度');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let event: any = null;
          try {
            event = JSON.parse(trimmed);
          } catch {
            return;
          }

          if (event.type === 'item' && event.temp_id) {
            updateRow(event.temp_id, {
              process_status: event.status || 'failed',
              process_message: event.reason || null
            });
          }

          if (event.type === 'summary') {
            setSummary({
              success: Number(event.success || 0),
              failed: Number(event.failed || 0),
              skipped: Number(event.skipped || 0)
            });
          }
        });
      }
    } catch (err: any) {
      setError(err?.message || '批量处理失败');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">PDF 批量上传</h3>
              <p className="text-xs text-slate-500">上传后自动识别单位和年度，确认后批量入库并同步解析到归档内容</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(92vh-150px)]">
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
              appendFiles(event.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}
          >
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <input
              id="pdf-batch-input"
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={(event) => appendFiles(event.target.files || [])}
            />
            <label htmlFor="pdf-batch-input" className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700">
              选择多个 PDF 文件
            </label>
            <p className="text-xs text-slate-500 mt-1">也可以拖拽到这里</p>
            {files.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-600 mb-2">已选择 {files.length} 个文件</p>
                <div className="max-h-24 overflow-y-auto space-y-1 text-left">
                  {files.map((file) => (
                    <div key={buildFileKey(file)} className="text-xs text-slate-600 break-all whitespace-normal leading-5">
                      {file.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={uploadForPreview}
              disabled={!canUpload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              <RefreshCcw className="w-4 h-4" />
              {uploading ? '识别中...' : '上传并识别'}
            </button>
            <button
              onClick={processBatch}
              disabled={!canProcess}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              <PlayCircle className="w-4 h-4" />
              {processing ? '处理中...' : '确认批量入库'}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {summary && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              完成: 成功 {summary.success}，失败 {summary.failed}，跳过 {summary.skipped}
            </div>
          )}

          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[210px_150px_300px_110px_110px_110px] gap-2 px-4 py-3 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                <div>文件名</div>
                <div>识别单位</div>
                <div>确认单位（部门 → 单位）</div>
                <div>年度</div>
                <div>匹配状态</div>
                <div>处理结果</div>
              </div>
              <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                {rows.map((row) => (
                  <div key={row.temp_id} className="grid grid-cols-[210px_150px_300px_110px_110px_110px] gap-2 px-4 py-3 text-sm items-start">
                    <div>
                      <p className="font-medium text-slate-700 break-all whitespace-normal leading-5" title={row.file_name}>{row.file_name}</p>
                      <p className="text-xs text-slate-500">{formatSize(row.size)}</p>
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => removeRow(row.temp_id)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600">
                      <p>{row.detected_unit_name || '-'}</p>
                      {row.warning && <p className="text-amber-700 mt-1">{row.warning}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <SearchableSelect
                        value={row.department_id}
                        options={departmentOptions.map((department) => ({
                          id: department.id,
                          label: department.name,
                          keywords: department.units.map((unit) => unit.name).join(' ')
                        }))}
                        onChange={(departmentId) => updateRowDepartment(row.temp_id, departmentId)}
                        placeholder="先选择部门（支持搜索）"
                        allowEmpty
                        emptyLabel="清空部门选择"
                      />
                      <SearchableSelect
                        value={row.unit_id}
                        options={(departmentById.get(row.department_id)?.units || []).map((unit) => ({
                          id: unit.id,
                          label: unit.name,
                          keywords: `${unit.code || ''} ${unit.department_name || ''}`
                        }))}
                        onChange={(unitId) => updateRow(row.temp_id, { unit_id: unitId })}
                        placeholder={row.department_id
                          ? (row.detected_scope === 'DEPARTMENT' ? '识别为部门口径，二级单位可留空' : '再选下属单位（可留空）')
                          : '请先选择部门'}
                        allowEmpty
                        emptyLabel="不选下属单位（默认部门）"
                        disabled={!row.department_id}
                      />
                      <p className="text-[11px] text-slate-500 truncate" title={resolveTargetLabelForRow(row)}>
                        入库目标：{resolveTargetLabelForRow(row)}
                      </p>
                    </div>
                    <input
                      type="number"
                      value={row.year}
                      onChange={(event) => updateRow(row.temp_id, { year: event.target.value })}
                      className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      placeholder="年份"
                    />
                    <div className="text-xs">
                      {row.match_status === 'exact' && <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700">精确匹配</span>}
                      {row.match_status === 'fuzzy' && <span className="px-2 py-1 rounded bg-amber-100 text-amber-700">模糊匹配</span>}
                      {row.match_status === 'none' && <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">未匹配</span>}
                    </div>
                    <div className="text-xs">
                      {row.process_status === 'success' && <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700">成功</span>}
                      {row.process_status === 'failed' && <span className="px-2 py-1 rounded bg-red-100 text-red-700">失败</span>}
                      {row.process_status === 'skipped' && <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">跳过</span>}
                      {(!row.process_status || row.process_status === 'idle') && <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">待处理</span>}
                      {row.process_message && <p className="text-red-700 mt-1">{row.process_message}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfBatchUpload;
