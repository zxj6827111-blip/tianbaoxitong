import React, { useState } from 'react';
import { UnitDetail } from '../../data/mockAdminData';
import { Clock, FileText, Activity, AlertCircle, CheckCircle2, Lock, Archive } from 'lucide-react';
import HistoryActualsPanel from './HistoryActualsPanel';

export type UnitDetailProps = {
  unit: UnitDetail | null;
  year?: number;
};

const UnitDetailPanel: React.FC<UnitDetailProps> = ({ unit, year = new Date().getFullYear() }) => {
  const [activeTab, setActiveTab] = useState<'detail' | 'archive'>('detail');

  if (!unit) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center animate-fade-in">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
          <Activity className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-sm font-medium">请选择左侧单位</p>
        <p className="text-xs mt-1">查看详情、归档数据与审计记录</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 bg-white">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900">{unit.name}</h2>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500 font-mono text-xs">
              {unit.code}
            </span>
            <span className="text-xs text-slate-400">更新于 {unit.updated_at}</span>
          </div>
        </div>

        <div className="flex gap-4 mt-4 border-b border-slate-100 -mb-4">
          <button
            onClick={() => setActiveTab('detail')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'detail'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            详细信息
          </button>
          <button
            onClick={() => setActiveTab('archive')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'archive'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Archive className="w-4 h-4" />
            历史归档
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'detail' ? (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-1 gap-3">
              <div
                className={`
                  p-3 rounded-lg border flex items-start gap-3
                  ${unit.archive_status === 'missing' ? 'bg-red-50 border-red-100' :
                    unit.archive_status === 'locked' ? 'bg-slate-50 border-slate-200' : 'bg-green-50 border-green-100'}
                `}
              >
                <div
                  className={`mt-0.5 ${
                    unit.archive_status === 'missing' ? 'text-red-500' :
                      unit.archive_status === 'locked' ? 'text-slate-500' : 'text-green-500'
                  }`}
                >
                  {unit.archive_status === 'missing' ? <AlertCircle className="w-4 h-4" /> :
                    unit.archive_status === 'locked' ? <Lock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                </div>
                <div>
                  <div
                    className={`text-sm font-bold ${
                      unit.archive_status === 'missing' ? 'text-red-800' :
                        unit.archive_status === 'locked' ? 'text-slate-700' : 'text-green-800'
                    }`}
                  >
                    {unit.archive_status === 'missing' ? '历史归档缺失' :
                      unit.archive_status === 'locked' ? '历史归档已锁定' : '历史归档已入库'}
                  </div>
                  <div className="text-xs opacity-80 mt-0.5">默认关注 {year - 1} 年归档数据</div>
                </div>
              </div>

              <div
                className={`
                  p-3 rounded-lg border flex items-start gap-3
                  ${unit.pending_count > 0 ? 'bg-orange-50 border-orange-100' : 'bg-slate-50 border-slate-100 opacity-60'}
                `}
              >
                <div className="mt-0.5 text-orange-500">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-700">
                    {unit.pending_count > 0 ? `${unit.pending_count} 条待审建议` : '无待审建议'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">需要人工审核确认</div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
                <FileText className="w-4 h-4 text-slate-400" />
                详细信息
              </h3>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500 mb-1">草稿状态</dt>
                  <dd className="font-medium text-slate-800">{unit.draft_status ?? '未创建'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 mb-1">基础信息</dt>
                  <dd className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${unit.baseinfo_ok ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                    <span className="font-medium text-slate-800">{unit.baseinfo_ok ? '完整' : '缺失'}</span>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
                <Clock className="w-4 h-4 text-slate-400" />
                审计摘要
              </h3>

              {unit.audit_logs && unit.audit_logs.length > 0 ? (
                <div className="relative pl-3 space-y-4 before:absolute before:left-[5px] before:top-1 before:bottom-0 before:w-px before:bg-slate-200">
                  {unit.audit_logs.map((log, index) => (
                    <div key={index} className="relative text-sm">
                      <div className="absolute -left-[16px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-200 border-2 border-white ring-1 ring-slate-100"></div>
                      <div className="text-slate-800 font-medium">{log.action}</div>
                      <div className="text-xs text-slate-400 mt-0.5 font-mono">{log.created_at}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-slate-400 text-xs bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  暂无审计记录
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full animate-fade-in">
            <HistoryActualsPanel unitId={unit.id} preferredYear={year - 1} />
          </div>
        )}
      </div>
    </div>
  );
};

export default UnitDetailPanel;
