import React from 'react';
import AdminConsole from '../components/admin/AdminConsole';

export type WorkbenchCard = {
  title: string;
  description: string;
  status: '待填报' | '待校验' | '可生成';
};

const workbenchCards: WorkbenchCard[] = [
  {
    title: '预算汇总表上传',
    description: '拖拽或选择 Excel，自动解析预算汇总、收支明细与“三公”经费。',
    status: '待填报'
  },
  {
    title: '校验规则与纠错建议',
    description: '查看系统校验结果，统一处理“可用于报告”的纠错建议。',
    status: '待校验'
  },
  {
    title: '生成报告版本',
    description: '生成预算公开报告版本，记录模板版本与草稿快照。',
    status: '可生成'
  }
];

export const WorkbenchDemo: React.FC = () => {
  return (
    <div>
      <h2>单位工作台（演示）</h2>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        用于演示“客户输入界面”的布局，保留任务卡片与进度提示。
      </p>
      <div className="workbench-grid">
        {workbenchCards.map((card) => (
          <div className="card" key={card.title}>
            <h3>{card.title}</h3>
            <div style={{ fontSize: 13, color: '#475569' }}>{card.description}</div>
            <div style={{ marginTop: 12, fontWeight: 600 }}>{card.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export { AdminConsole };
