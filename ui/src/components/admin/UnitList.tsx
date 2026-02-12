import React, { useState } from 'react';
import { UnitRow } from '../../data/mockAdminData';
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  FileQuestion,
  Trash2,
  Plus,
  LayoutGrid,
  List as ListIcon,
  Building2,
  PenSquare
} from 'lucide-react';

export type UnitListProps = {
  units: UnitRow[];
  page: number;
  pageSize: number;
  total: number;
  selectedUnitId?: string | null;
  filter: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: string | null) => void;
  onPageChange: (page: number) => void;
  onSelect: (id: string) => void;
  onDelete?: (unit: UnitRow) => void;
  onEdit?: (unit: UnitRow) => void;
  viewMode?: 'units' | 'department';
  onViewModeChange?: (mode: 'units' | 'department') => void;
  onAddUnit?: () => void;
};

const archiveBadge = (status: UnitRow['archive_status']) => {
  if (status === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 border border-red-100">
        缺归档
      </span>
    );
  }

  if (status === 'locked') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
        已锁定
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600 border border-green-100">
      <CheckCircle2 className="w-3 h-3" /> 已入库
    </span>
  );
};

const baseInfoBadge = (isOk: boolean) => {
  if (isOk) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-100">
      缺基础
    </span>
  );
};

const UnitList: React.FC<UnitListProps> = ({
  units,
  page,
  pageSize,
  total,
  selectedUnitId,
  filter,
  search,
  onSearchChange,
  onFilterChange,
  onPageChange,
  onSelect,
  onDelete,
  onEdit,
  onAddUnit
}) => {
  const [viewType, setViewType] = useState<'grid' | 'list'>('grid');
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="flex flex-col h-full bg-slate-50/30">
      <div className="p-3 border-b border-slate-200 bg-white flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            className="pl-9 pr-3 py-1.5 w-full text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            placeholder="搜索单位名称/代码"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="h-6 w-px bg-slate-200 mx-1"></div>

        <div className="flex gap-2 items-center">
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 mr-2">
            <button
              onClick={() => setViewType('grid')}
              className={`p-1.5 rounded-md transition-all ${viewType === 'grid' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}
              title="网格视图"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewType('list')}
              className={`p-1.5 rounded-md transition-all ${viewType === 'list' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}
              title="列表视图"
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>

          {onAddUnit && (
            <button
              onClick={onAddUnit}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-brand-200 bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              添加单位
            </button>
          )}

          <button
            onClick={() => onFilterChange(filter === 'missingArchive' ? null : 'missingArchive')}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5
              ${filter === 'missingArchive'
                ? 'bg-red-50 border-red-200 text-red-600'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}
            `}
          >
            <FileQuestion className="w-3.5 h-3.5" />
            缺归档
          </button>

          <button
            onClick={() => onFilterChange(filter === 'pendingSug' ? null : 'pendingSug')}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5
              ${filter === 'pendingSug'
                ? 'bg-orange-50 border-orange-200 text-orange-600'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}
            `}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            有待审
          </button>
        </div>
      </div>

      {viewType === 'grid' ? (
        <div className="flex-1 overflow-y-auto p-4 content-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {units.map((unit) => {
              const isSelected = selectedUnitId === unit.id;
              return (
                <div
                  key={unit.id}
                  onClick={() => onSelect(unit.id)}
                  className={`
                    group relative flex flex-col p-4 rounded-xl border transition-all cursor-pointer
                    ${isSelected
                      ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50/10'
                      : 'border-slate-200 bg-white hover:border-brand-300 hover:shadow-md'}
                  `}
                >
                  <div className="flex items-start justify-between mb-3 relative">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-slate-100 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-slate-700 line-clamp-2">{unit.name}</h3>
                      </div>
                    </div>

                    <div className="absolute top-0 right-0 p-1 hidden group-hover:flex items-center gap-1 bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-lg transition-all z-10">
                      {onEdit && (
                        <button
                          onClick={(event) => { event.stopPropagation(); onEdit(unit); }}
                          className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-md transition-colors"
                          title="编辑"
                        >
                          <PenSquare className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={(event) => { event.stopPropagation(); onDelete(unit); }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    {archiveBadge(unit.archive_status)}
                    {baseInfoBadge(unit.baseinfo_ok)}
                    {unit.pending_count > 0 && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-50 text-orange-600 flex items-center gap-1 border border-orange-100">
                        <AlertTriangle className="w-3 h-3" /> {unit.pending_count} 条待审
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {onAddUnit && (
              <button
                onClick={onAddUnit}
                className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-brand-400 group transition-all h-full min-h-[140px]"
              >
                <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-sm">
                  <Plus className="w-5 h-5 text-slate-400 group-hover:text-brand-500" />
                </div>
                <span className="text-sm font-medium text-slate-500 group-hover:text-brand-600">添加新单位</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-[30%]">单位名称</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-[15%]">归档状态</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-[25%]">基础信息更新时间</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-slate-400 text-sm">
                    未找到相关单位
                  </td>
                </tr>
              ) : (
                units.map((unit) => (
                  <tr
                    key={unit.id}
                    onClick={() => onSelect(unit.id)}
                    className={`group transition-colors cursor-pointer ${selectedUnitId === unit.id ? 'bg-brand-50/60 hover:bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className={`font-medium ${selectedUnitId === unit.id ? 'text-brand-700' : 'text-slate-700'}`}>
                          {unit.name}
                        </span>
                        <span className="text-xs text-slate-400 font-mono mt-0.5">{unit.code}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{archiveBadge(unit.archive_status)}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      <div className="flex flex-col gap-1 items-start">
                        {baseInfoBadge(unit.baseinfo_ok)}
                        <span className="text-[10px] text-slate-400">{new Date(unit.updated_at).toLocaleDateString()}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onDelete && (
                          <button
                            onClick={(event) => { event.stopPropagation(); onDelete(unit); }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded bg-white border border-slate-200 shadow-sm"
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <button
            className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(page - 1, 1))}
          >
            上一页
          </button>
          <span className="font-medium">{page} / {totalPages} 页</span>
          <button
            className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(page + 1, totalPages))}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
};

export default UnitList;
