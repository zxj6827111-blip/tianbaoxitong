import React, { useMemo, useState } from 'react';
import Badge from '../ui/Badge';
import { DepartmentNode } from '../../data/mockAdminData';

export type DepartmentTreeProps = {
  departments: DepartmentNode[];
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
};

type DepartmentTreeNode = DepartmentNode & { children: DepartmentTreeNode[] };

const buildTree = (departments: DepartmentNode[]): DepartmentTreeNode[] => {
  const map = new Map<string, DepartmentTreeNode>();
  departments.forEach((dept) => {
    map.set(dept.id, { ...dept, children: [] });
  });

  const roots: DepartmentTreeNode[] = [];
  map.forEach((dept) => {
    if (dept.parent_id && map.has(dept.parent_id)) {
      map.get(dept.parent_id)!.children.push(dept);
    } else {
      roots.push(dept);
    }
  });

  return roots;
};

const DepartmentTree: React.FC<DepartmentTreeProps> = ({ departments, selectedId, onSelect }) => {
  const tree = useMemo(() => buildTree(departments), [departments]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const summary = useMemo(() => {
    return departments.reduce(
      (acc, dept) => ({
        total_units: acc.total_units + dept.total_units,
        todo_units: acc.todo_units + dept.todo_units
      }),
      { total_units: 0, todo_units: 0 }
    );
  }, [departments]);

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderNode = (node: DepartmentTreeNode, depth = 0) => {
    const isCollapsed = collapsed[node.id];
    return (
      <li key={node.id}>
        <div
          className={`tree-item ${selectedId === node.id ? 'active' : ''}`}
          style={{ marginLeft: depth * 12 }}
          onClick={() => onSelect(node.id)}
          role="button"
          tabIndex={0}
        >
          <div className="tree-row">
            <div>
              <strong>{node.name}</strong>
              <div style={{ fontSize: 12, color: '#64748b' }}>{node.code}</div>
            </div>
            {node.children.length > 0 && (
              <button
                className="button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(node.id);
                }}
              >
                {isCollapsed ? '展开' : '折叠'}
              </button>
            )}
          </div>
          <div className="badges">
            <Badge variant="default">单位 {node.total_units}</Badge>
            <Badge variant={node.todo_units > 0 ? 'warning' : 'success'}>
              待办 {node.todo_units}
            </Badge>
          </div>
        </div>
        {!isCollapsed && node.children.length > 0 && (
          <ul className="tree-list">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className="tree-list">
      <li>
        <div
          className={`tree-item ${selectedId === null ? 'active' : ''}`}
          onClick={() => onSelect(null)}
          role="button"
          tabIndex={0}
        >
          <div className="tree-row">
            <div>
              <strong>全部部门</strong>
              <div style={{ fontSize: 12, color: '#64748b' }}>全量统计</div>
            </div>
          </div>
          <div className="badges">
            <Badge variant="default">单位 {summary.total_units}</Badge>
            <Badge variant={summary.todo_units > 0 ? 'warning' : 'success'}>
              待办 {summary.todo_units}
            </Badge>
          </div>
        </div>
      </li>
      {tree.map((node) => renderNode(node))}
    </ul>
  );
};

export default DepartmentTree;
