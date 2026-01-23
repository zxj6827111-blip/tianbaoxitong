import React from 'react';
import Badge from '../ui/Badge';
import { UnitDetail } from '../../data/mockAdminData';

export type UnitDetailProps = {
  unit: UnitDetail | null;
};

const UnitDetailPanel: React.FC<UnitDetailProps> = ({ unit }) => {
  if (!unit) {
    return <div className="empty">请选择左侧单位以查看详情</div>;
  }

  return (
    <div>
      <h2>{unit.name}</h2>
      <div style={{ color: '#64748b', fontSize: 13 }}>{unit.code}</div>
      <div className="badges" style={{ marginTop: 12 }}>
        <Badge variant={unit.archive_status === 'missing' ? 'danger' : unit.archive_status === 'locked' ? 'warning' : 'success'}>
          {unit.archive_status === 'missing'
            ? '历史归档缺失'
            : unit.archive_status === 'locked'
            ? '历史归档已锁定'
            : '历史归档已入库'}
        </Badge>
        <Badge variant={unit.pending_count > 0 ? 'danger' : 'default'}>
          待审纠错建议 {unit.pending_count}
        </Badge>
        <Badge variant={unit.baseinfo_ok ? 'success' : 'warning'}>
          基础信息{unit.baseinfo_ok ? '完整' : '缺失'}
        </Badge>
      </div>
      <div className="detail-list">
        <div className="detail-item">
          <span>最近更新时间</span>
          <span>{unit.updated_at}</span>
        </div>
        <div className="detail-item">
          <span>草稿状态</span>
          <span>{unit.draft_status ?? '—'}</span>
        </div>
      </div>
      <div className="section-title">审计摘要</div>
      {unit.audit_logs && unit.audit_logs.length > 0 ? (
        <div className="detail-list">
          {unit.audit_logs.map((log) => (
            <div className="detail-item" key={`${log.action}-${log.created_at}`}>
              <span>{log.action}</span>
              <span>{log.created_at}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">暂无审计记录</div>
      )}
    </div>
  );
};

export default UnitDetailPanel;
