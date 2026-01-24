import React from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { UnitRow } from '../../data/mockAdminData';
import { Search, Filter, AlertCircle, Clock, CheckCircle2, AlertTriangle, FileQuestion, Globe2 } from 'lucide-react';

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
};

const archiveBadgeVariant = (status: UnitRow['archive_status']) => {
  if (status === 'missing') return 'danger';
  if (status === 'locked') return 'warning';
  return 'success';
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
  onSelect
}) => {
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
              onChange={(e) => onSearchChange(e.target.value)}
           />
        </div>
        
        <div className="h-6 w-px bg-slate-200 mx-1"></div>

        <div className="flex gap-2">
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
             有纠错
           </button>

            <button
             onClick={() => onFilterChange(filter === 'missingBase' ? null : 'missingBase')}
             className={`
                px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5
                ${filter === 'missingBase' 
                  ? 'bg-amber-50 border-amber-200 text-amber-600' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}
             `}
           >
             <Globe2 className="w-3.5 h-3.5" />
             缺基础
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full text-sm text-left border-collapse">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3 font-semibold border-b border-slate-200">单位信息</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200">状态概览</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200">更新时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {units.length === 0 ? (
               <tr>
                 <td colSpan={3} className="px-4 py-12 text-center text-slate-400 text-sm">
                    未找到相关单位
                 </td>
               </tr>
            ) : (
                units.map((unit) => (
                  <tr
                    key={unit.id}
                    className={`cursor-pointer transition-colors ${
                      unit.id === selectedUnitId ? 'bg-brand-50/60 hover:bg-brand-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => onSelect(unit.id)}
                  >
                    <td className="px-4 py-3 max-w-[200px]">
                      <div className="font-medium text-slate-900 truncate" title={unit.name}>{unit.name}</div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">{unit.code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        {/* Archive Status */}
                        {unit.archive_status === 'missing' && (
                           <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 border border-red-100">
                             缺归档
                           </span>
                        )}
                        {unit.archive_status === 'locked' && (
                           <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                             已锁定
                           </span>
                        )}
                        
                        {/* Pending Suggestions */}
                        {unit.pending_count > 0 && (
                           <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-600 border border-orange-100">
                             <AlertCircle className="w-3 h-3" />
                             {unit.pending_count} 纠错
                           </span>
                        )}
                        
                        {/* Base Info */}
                        {!unit.baseinfo_ok && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-100">
                             缺基础
                           </span>
                        )}

                        {/* All Good */}
                        {unit.archive_status === 'archived' && unit.pending_count === 0 && unit.baseinfo_ok && (
                           <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600 border border-green-100">
                             <CheckCircle2 className="w-3 h-3" /> 正常
                           </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono whitespace-nowrap">
                       {unit.updated_at.split(' ')[0]}
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
        <button
          className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(page - 1, 1))}
        >
          上一页
        </button>
        <span className="font-medium">
          {page} / {totalPages} 页
        </span>
        <button
          className="px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(page + 1, totalPages))}
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export default UnitList;
