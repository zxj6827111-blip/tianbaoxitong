import React, { useEffect, useState } from 'react';
import { UnitDetail } from '../../data/mockAdminData';
import { Activity } from 'lucide-react';
import HistoryActualsPanel from './HistoryActualsPanel';
import ArchivePanel from './ArchivePanel';

export type UnitDetailProps = {
  unit: UnitDetail | null;
  year?: number;
};

const UnitDetailPanel: React.FC<UnitDetailProps> = ({ unit, year = new Date().getFullYear() }) => {
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0);
  const [archiveYear, setArchiveYear] = useState(year - 1);
  const [historyYearCount, setHistoryYearCount] = useState(0);

  useEffect(() => {
    setArchiveYear(year - 1);
  }, [year]);

  if (!unit) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center animate-fade-in">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
          <Activity className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-sm font-medium">请选择左侧单位</p>
        <p className="text-xs mt-1">查看详情、历史归档与审计记录</p>
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
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="h-full animate-fade-in space-y-4">
          {unit.department_id ? (
            <div className="p-4 border border-slate-200 rounded-lg bg-white">
              <ArchivePanel
                departmentId={unit.department_id}
                unitId={unit.id}
                year={archiveYear}
                historyYearCount={historyYearCount}
                onYearChange={setArchiveYear}
                onFactsSaved={() => setArchiveRefreshKey((value) => value + 1)}
              />
            </div>
          ) : (
            <div className="p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50 text-slate-500 text-sm">
              当前单位缺少部门信息，无法上传历史归档文件。
            </div>
          )}

          <div className="p-4 border border-slate-200 rounded-lg bg-white">
            <HistoryActualsPanel
              unitId={unit.id}
              preferredYear={archiveYear}
              fixedYear={archiveYear}
              hideYearSelector
              refreshKey={archiveRefreshKey}
              onYearsCountChange={setHistoryYearCount}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnitDetailPanel;
