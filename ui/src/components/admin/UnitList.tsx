import React from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { UnitRow } from '../../data/mockAdminData';

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
    <div>
      <div className="toolbar">
        <Input
          placeholder="搜索单位名称/代码"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <Button
          variant={filter === 'missingArchive' ? 'primary' : 'default'}
          onClick={() => onFilterChange(filter === 'missingArchive' ? null : 'missingArchive')}
        >
          缺归档
        </Button>
        <Button
          variant={filter === 'pendingSug' ? 'primary' : 'default'}
          onClick={() => onFilterChange(filter === 'pendingSug' ? null : 'pendingSug')}
        >
          有待审纠错建议
        </Button>
        <Button
          variant={filter === 'missingBase' ? 'primary' : 'default'}
          onClick={() => onFilterChange(filter === 'missingBase' ? null : 'missingBase')}
        >
          缺基础信息
        </Button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>单位名称</th>
            <th>单位代码</th>
            <th>归档状态</th>
            <th>待审建议</th>
            <th>基础信息</th>
            <th>最后更新时间</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr
              key={unit.id}
              style={{ background: unit.id === selectedUnitId ? '#e0f2fe' : undefined }}
              onClick={() => onSelect(unit.id)}
            >
              <td>{unit.name}</td>
              <td>{unit.code}</td>
              <td>
                <Badge variant={archiveBadgeVariant(unit.archive_status)}>
                  {unit.archive_status === 'missing'
                    ? '缺失'
                    : unit.archive_status === 'locked'
                    ? '已锁定'
                    : '已入库'}
                </Badge>
              </td>
              <td>
                <Badge variant={unit.pending_count > 0 ? 'danger' : 'default'}>
                  {unit.pending_count > 0 ? `${unit.pending_count} 条` : '无待审'}
                </Badge>
              </td>
              <td>
                {unit.baseinfo_ok ? (
                  <Badge variant="success">完整</Badge>
                ) : (
                  <Badge variant="warning">缺失</Badge>
                )}
              </td>
              <td>{unit.updated_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pagination">
        <Button
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(page - 1, 1))}
        >
          上一页
        </Button>
        <span>
          第 {page} / {totalPages} 页 · 共 {total} 条
        </span>
        <Button
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(page + 1, totalPages))}
        >
          下一页
        </Button>
      </div>
    </div>
  );
};

export default UnitList;
