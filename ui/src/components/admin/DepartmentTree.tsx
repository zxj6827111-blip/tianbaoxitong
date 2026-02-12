import React, { useMemo, useState } from 'react';
import { DepartmentNode } from '../../data/mockAdminData';
import {
  ChevronRight,
  ChevronDown,
  Building2,
  Folder,
  MoreHorizontal,
  Edit2,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  X
} from 'lucide-react';

export type DepartmentTreeProps = {
  departments: DepartmentNode[];
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  onEdit?: (node: DepartmentNode) => void;
  onDelete?: (node: DepartmentNode) => void;
  onAdd?: (parentId: string | null) => void;
  onReorder?: (node: DepartmentNode, direction: 'up' | 'down') => void;
  selectedDistrict?: string;
  onDistrictChange?: (district: string) => void;
};

const DISTRICTS = [
  '黄浦区', '徐汇区', '长宁区', '静安区', '普陀区',
  '虹口区', '杨浦区', '闵行区', '宝山区', '嘉定区',
  '浦东新区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区'
];

type DepartmentTreeNode = DepartmentNode & { children: DepartmentTreeNode[] };

const buildTree = (departments: DepartmentNode[]): DepartmentTreeNode[] => {
  const map = new Map<string, DepartmentTreeNode>();
  const nodes = departments.map((dept) => ({ ...dept, children: [] }));
  nodes.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  nodes.forEach((dept) => {
    map.set(dept.id, dept);
  });

  const roots: DepartmentTreeNode[] = [];
  nodes.forEach((dept) => {
    if (dept.parent_id && map.has(dept.parent_id)) {
      map.get(dept.parent_id)!.children.push(dept);
    } else {
      roots.push(dept);
    }
  });

  return roots;
};

const DepartmentTree: React.FC<DepartmentTreeProps> = ({
  departments,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
  onReorder,
  selectedDistrict,
  onDistrictChange
}) => {
  const tree = useMemo(() => buildTree(departments), [departments]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

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

  const renderActionButtons = (node: DepartmentNode) => {
    const isOpen = activeMenuId === node.id;

    return (
      <div
        className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-all duration-200 ${
          isOpen ? 'opacity-100 z-20' : 'opacity-0 group-hover:opacity-100'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {isOpen ? (
          <div className="flex items-center gap-1 bg-white shadow-lg border border-slate-100 rounded-lg p-1 animate-in zoom-in-95 duration-200">
            {onReorder && (
              <>
                <button
                  onClick={(event) => { event.stopPropagation(); onReorder(node, 'up'); }}
                  className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded"
                  title="上移"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={(event) => { event.stopPropagation(); onReorder(node, 'down'); }}
                  className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded"
                  title="下移"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </>
            )}
            {onEdit && (
              <button
                onClick={(event) => { event.stopPropagation(); onEdit(node); }}
                className="p-1 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded"
                title="编辑"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            )}
            {onAdd && (
              <button
                onClick={(event) => { event.stopPropagation(); onAdd(node.id); }}
                className="p-1 hover:bg-green-50 text-slate-400 hover:text-green-600 rounded"
                title="添加子部门"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(event) => { event.stopPropagation(); onDelete(node); }}
                className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded"
                title="删除"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            <div className="w-px h-3 bg-slate-200 mx-0.5"></div>
            <button
              onClick={(event) => { event.stopPropagation(); setActiveMenuId(null); }}
              className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded"
              title="关闭"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={(event) => { event.stopPropagation(); setActiveMenuId(node.id); }}
            className="p-1.5 hover:bg-white bg-white/50 text-slate-400 hover:text-brand-600 rounded-lg backdrop-blur-sm shadow-sm border border-transparent hover:border-slate-200 transition-all"
            title="更多操作"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

  const renderNode = (node: DepartmentTreeNode, depth = 0) => {
    const isCollapsed = collapsed[node.id];
    const hasChildren = node.children.length > 0;
    const isSelected = selectedId === node.id;

    return (
      <li key={node.id}>
        <div
          className={`
            group relative flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-200 border border-transparent
            ${isSelected ? 'bg-brand-50 border-brand-200 text-brand-900' : 'hover:bg-slate-50 text-slate-700'}
          `}
          style={{ marginLeft: depth * 16 }}
          onClick={() => onSelect(node.id)}
          role="button"
          tabIndex={0}
        >
          <div className="flex-1 flex items-center gap-1.5 overflow-hidden pr-2">
            <button
              className={`p-1 rounded hover:bg-black/5 text-slate-400 transition-colors ${hasChildren ? 'visible' : 'invisible'}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapsed(node.id);
              }}
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-brand-500' : 'text-slate-400'}`} />

            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate" title={node.name}>{node.name}</div>
            </div>
          </div>

          {node.todo_units > 0 && (
            <div className="flex items-center gap-1 shrink-0 mr-2 group-hover:opacity-0 transition-opacity">
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-orange-100 px-1 text-xs font-medium text-orange-600">
                {node.todo_units}
              </span>
            </div>
          )}

          {renderActionButtons(node)}
        </div>

        {!isCollapsed && hasChildren && (
          <ul className="mt-1 space-y-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {onDistrictChange && (
        <div className="px-2 pt-2 pb-1">
          <select
            className="w-full text-sm border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-700 bg-white"
            value={selectedDistrict}
            onChange={(event) => onDistrictChange(event.target.value)}
          >
            <option value="">请选择区县</option>
            {DISTRICTS.map((district) => (
              <option key={district} value={district}>{district}</option>
            ))}
          </select>
        </div>
      )}

      <ul className="space-y-0.5 p-2 pb-20 flex-1 overflow-y-auto">
        <li>
          <div
            className={`
              group relative flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-200 border border-transparent mb-1
              ${selectedId === null ? 'bg-brand-50 border-brand-200 text-brand-900' : 'hover:bg-slate-50 text-slate-700'}
            `}
            onClick={() => onSelect(null)}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 flex items-center justify-center">
                <Building2 className={`w-4 h-4 ${selectedId === null ? 'text-brand-500' : 'text-slate-400'}`} />
              </div>
              <div>
                <div className="font-bold text-sm">全部部门</div>
                <div className={`text-xs ${selectedId === null ? 'text-brand-400' : 'text-slate-400'}`}>全量统计</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {summary.todo_units > 0 && (
                <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-orange-100 px-1 text-xs font-medium text-orange-600 group-hover:opacity-0 transition-opacity">
                  {summary.todo_units}
                </span>
              )}

              {onAdd && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-1/2 -translate-y-1/2">
                  <button
                    onClick={(event) => { event.stopPropagation(); onAdd(null); }}
                    className="p-1.5 hover:bg-brand-100 text-brand-500 hover:text-brand-700 rounded bg-white shadow-sm border border-slate-100"
                    title="添加一级部门"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </li>

        {tree.map((node) => renderNode(node))}
      </ul>
    </div>
  );
};

export default DepartmentTree;
