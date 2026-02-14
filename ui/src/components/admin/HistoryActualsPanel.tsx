import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Database } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

type HistoryYear = {
  year: number;
  field_count: number;
  is_locked: boolean;
};

type HistoryField = {
  key: string;
  label: string;
  group: string;
  value: number | null;
};

type HistoryActualsPanelProps = {
  unitId: string;
  preferredYear?: number;
  fixedYear?: number;
  hideYearSelector?: boolean;
  refreshKey?: number;
  onYearsCountChange?: (count: number) => void;
};

const groupOrder = ['收支预算', '财政拨款', '三公经费'];

const ZERO_DEFAULT_KEYS = new Set([
  'three_public_vehicle_total',
  'three_public_vehicle_purchase',
  'three_public_vehicle_operation'
]);

const isMissingValue = (value: number | null) => value === null || value === undefined || Number.isNaN(Number(value));

const shouldRenderZeroWhenMissing = (field: HistoryField) => (
  isMissingValue(field.value) && ZERO_DEFAULT_KEYS.has(field.key)
);

const formatValue = (field: HistoryField) => {
  if (shouldRenderZeroWhenMissing(field)) {
    return '0.00 万元';
  }
  if (isMissingValue(field.value)) {
    return '未入库';
  }
  return `${Number(field.value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} 万元`;
};

const HistoryActualsPanel: React.FC<HistoryActualsPanelProps> = ({
  unitId,
  preferredYear,
  fixedYear,
  hideYearSelector = false,
  refreshKey = 0,
  onYearsCountChange
}) => {
  const [years, setYears] = useState<HistoryYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [fields, setFields] = useState<HistoryField[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);

  useEffect(() => {
    let ignore = false;

    const run = async () => {
      setLoadingYears(true);
      try {
        const data = await apiClient.getUnitHistoryYears(unitId);
        const nextYears: HistoryYear[] = data.years || [];
        if (ignore) return;

        setYears(nextYears);
        onYearsCountChange?.(nextYears.length);

        if (nextYears.length === 0) {
          setSelectedYear(null);
          setFields([]);
          return;
        }

        const fixed = Number.isInteger(fixedYear) ? Number(fixedYear) : null;
        const preferred = Number.isInteger(preferredYear) ? Number(preferredYear) : null;
        const matchedPreferred = preferred !== null ? nextYears.find((item) => item.year === preferred) : null;

        setSelectedYear((prev) => {
          if (fixed !== null) return fixed;
          if (prev && nextYears.some((item) => item.year === prev)) return prev;
          return matchedPreferred ? matchedPreferred.year : nextYears[0].year;
        });
      } catch (error) {
        if (!ignore) {
          setYears([]);
          setSelectedYear(null);
          setFields([]);
          onYearsCountChange?.(0);
        }
      } finally {
        if (!ignore) {
          setLoadingYears(false);
        }
      }
    };

    run();
    return () => {
      ignore = true;
    };
  }, [unitId, preferredYear, fixedYear, refreshKey, onYearsCountChange]);

  useEffect(() => {
    if (!selectedYear) {
      setFields([]);
      return;
    }

    let ignore = false;
    const run = async () => {
      setLoadingFields(true);
      try {
        const data = await apiClient.getUnitHistoryByYear(unitId, selectedYear);
        if (!ignore) {
          setFields(data.fields || []);
        }
      } catch (error) {
        if (!ignore) {
          setFields([]);
        }
      } finally {
        if (!ignore) {
          setLoadingFields(false);
        }
      }
    };

    run();
    return () => {
      ignore = true;
    };
  }, [selectedYear, unitId, refreshKey]);

  const groupedFields = useMemo(() => {
    const grouped = new Map<string, HistoryField[]>();
    for (const field of fields) {
      const list = grouped.get(field.group) || [];
      list.push(field);
      grouped.set(field.group, list);
    }
    return grouped;
  }, [fields]);

  if (loadingYears) {
    return <div className="p-4 text-sm text-slate-500">正在加载历史归档字段...</div>;
  }

  return (
    <div className="space-y-4">
      {years.length === 0 ? (
        <div className="p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50 text-slate-500 text-sm">
          当前单位暂无可用的历史归档数值字段。请先上传报告并点击“提取数据”入库。
        </div>
      ) : (
        <>
          {!(hideYearSelector || fixedYear) ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 text-sm text-slate-700">
                <CalendarDays className="w-4 h-4 text-slate-500" />
                <span>归档年份</span>
              </div>
              <select
                value={selectedYear ?? undefined}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {years.map((item) => (
                  <option key={item.year} value={item.year}>
                    {item.year} 年{item.is_locked ? '（已锁定）' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {loadingFields ? (
            <div className="p-4 text-sm text-slate-500">正在加载字段明细...</div>
          ) : (
            <div className="space-y-4">
              {groupOrder.map((groupName) => {
                const list = groupedFields.get(groupName) || [];
                if (list.length === 0) return null;
                return (
                  <section key={groupName} className="border border-slate-200 rounded-lg bg-white">
                    <header className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Database className="w-4 h-4 text-slate-500" />
                      {groupName}
                    </header>
                    <div className="divide-y divide-slate-100">
                      {list.map((field) => {
                        const displayAsMissing = isMissingValue(field.value) && !shouldRenderZeroWhenMissing(field);
                        return (
                          <div key={field.key} className="px-4 py-3 grid grid-cols-[1fr_auto] gap-3 items-center">
                            <div className="text-sm text-slate-700">{field.label}</div>
                            <div className={`text-sm font-medium ${displayAsMissing ? 'text-slate-400' : 'text-slate-900'}`}>
                              {formatValue(field)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HistoryActualsPanel;
