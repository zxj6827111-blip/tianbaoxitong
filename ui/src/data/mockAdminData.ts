export type DepartmentNode = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  total_units: number;
  todo_units: number;
  missing_archive: number;
  pending_suggestions: number;
  missing_baseinfo: number;
  sort_order?: number;
};

export type UnitRow = {
  id: string;
  code: string;
  name: string;
  department_id: string;
  archive_status: 'missing' | 'stored' | 'locked';
  pending_count: number;
  baseinfo_ok: boolean;
  updated_at: string;
  draft_status?: string | null;
  sort_order?: number;
};

export type UnitDetail = UnitRow & {
  audit_logs?: Array<{ action: string; created_at: string }>;
};

export const mockDepartments: DepartmentNode[] = [
  {
    id: 'dept-1',
    code: 'D001',
    name: '财政局',
    parent_id: null,
    total_units: 12,
    todo_units: 4,
    missing_archive: 2,
    pending_suggestions: 2,
    missing_baseinfo: 1
  },
  {
    id: 'dept-2',
    code: 'D002',
    name: '教育局',
    parent_id: null,
    total_units: 18,
    todo_units: 6,
    missing_archive: 3,
    pending_suggestions: 1,
    missing_baseinfo: 2
  },
  {
    id: 'dept-3',
    code: 'D003',
    name: '民政局',
    parent_id: null,
    total_units: 9,
    todo_units: 2,
    missing_archive: 1,
    pending_suggestions: 1,
    missing_baseinfo: 0
  }
];

export const mockUnits: UnitRow[] = [
  {
    id: 'unit-1',
    code: 'U001',
    name: '区财政国库支付中心',
    department_id: 'dept-1',
    archive_status: 'stored',
    pending_count: 2,
    baseinfo_ok: true,
    updated_at: '2024-09-12 16:20',
    draft_status: 'DRAFT'
  },
  {
    id: 'unit-2',
    code: 'U002',
    name: '财政绩效评价中心',
    department_id: 'dept-1',
    archive_status: 'missing',
    pending_count: 0,
    baseinfo_ok: false,
    updated_at: '2024-09-11 09:18',
    draft_status: 'PENDING'
  },
  {
    id: 'unit-3',
    code: 'U003',
    name: '区财政监督检查所',
    department_id: 'dept-1',
    archive_status: 'locked',
    pending_count: 1,
    baseinfo_ok: true,
    updated_at: '2024-09-09 11:03',
    draft_status: 'APPROVED'
  },
  {
    id: 'unit-4',
    code: 'U010',
    name: '区教育财务结算中心',
    department_id: 'dept-2',
    archive_status: 'missing',
    pending_count: 0,
    baseinfo_ok: true,
    updated_at: '2024-09-07 14:42',
    draft_status: 'DRAFT'
  }
];

export const mockUnitDetail: UnitDetail = {
  ...mockUnits[0],
  audit_logs: [
    { action: '同步历史归档数据', created_at: '2024-09-11 10:11' },
    { action: '新增纠错建议 2 条', created_at: '2024-09-10 09:02' }
  ]
};
