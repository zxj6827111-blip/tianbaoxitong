import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft, Settings } from 'lucide-react';
import DepartmentTree from './DepartmentTree';
import UnitList from './UnitList';
import UnitDetailPanel from './UnitDetail';
import OrgImportModal from './OrgImportModal';
import {
  DepartmentNode,
  UnitDetail,
  UnitRow,
  mockDepartments,
  mockUnitDetail,
  mockUnits
} from '../../data/mockAdminData';

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_YEAR = 2024;

const applyMockFilters = (
  units: UnitRow[],
  {
    departmentId,
    q,
    filter
  }: { departmentId?: string | null; q?: string; filter?: string | null }
) => {
  return units.filter((unit) => {
    if (departmentId && unit.department_id !== departmentId) {
      return false;
    }
    if (q) {
      const keyword = q.toLowerCase();
      if (!unit.name.toLowerCase().includes(keyword) && !unit.code.toLowerCase().includes(keyword)) {
        return false;
      }
    }
    if (filter === 'missingArchive' && unit.archive_status !== 'missing') {
      return false;
    }
    if (filter === 'pendingSug' && unit.pending_count === 0) {
      return false;
    }
    if (filter === 'missingBase' && unit.baseinfo_ok) {
      return false;
    }
    return true;
  });
};

const AdminConsole: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [unitDetail, setUnitDetail] = useState<UnitDetail | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(searchParams.get('unit'));
  const [filter, setFilter] = useState<string | null>(searchParams.get('filter'));
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    const handler = window.setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(handler);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter) {
      params.set('filter', filter);
    } else {
      params.delete('filter');
    }
    if (selectedUnitId) {
      params.set('unit', selectedUnitId);
    } else {
      params.delete('unit');
    }
    setSearchParams(params, { replace: true });
  }, [filter, selectedUnitId, setSearchParams]);

  const loadDepartments = async () => {
    try {
      const response = await fetch(`/api/admin/departments?year=${DEFAULT_YEAR}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        throw new Error('Failed');
      }
      const data = await response.json();
      setDepartments(data.departments ?? []);
    } catch (error) {
      setDepartments(mockDepartments);
    }
  };

  const loadUnits = async () => {
    try {
      const params = new URLSearchParams();
      params.set('year', String(DEFAULT_YEAR));
      params.set('page', String(page));
      params.set('pageSize', String(DEFAULT_PAGE_SIZE));
      if (selectedDepartment) {
        params.set('department_id', selectedDepartment);
      }
      if (searchQuery) {
        params.set('q', searchQuery);
      }
      if (filter) {
        params.set('filter', filter);
      }
      const response = await fetch(`/api/admin/units?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        throw new Error('Failed');
      }
      const data = await response.json();
      setUnits(data.units ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      const filtered = applyMockFilters(mockUnits, {
        departmentId: selectedDepartment,
        q: searchQuery,
        filter
      });
      const paged = filtered.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);
      setUnits(paged);
      setTotal(filtered.length);
    }
  };

  const loadUnitDetail = async (unitId: string) => {
    try {
      const response = await fetch(`/api/admin/units/${unitId}?year=${DEFAULT_YEAR}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        throw new Error('Failed');
      }
      const data = await response.json();
      setUnitDetail(data.unit ?? null);
    } catch (error) {
      setUnitDetail({ ...mockUnitDetail, id: unitId });
    }
  };

  const handleReorder = async (node: DepartmentNode, direction: 'up' | 'down') => {
    try {
      // Get siblings to calculate new sort_order
      const siblings = departments.filter(d => d.parent_id === node.parent_id);
      const currentIndex = siblings.findIndex(d => d.id === node.id);
      
      if ((direction === 'up' && currentIndex === 0) || 
          (direction === 'down' && currentIndex === siblings.length - 1)) {
        return; // Already at boundary
      }

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      const items = [
        { id: node.id, sort_order: siblings[targetIndex].sort_order },
        { id: siblings[targetIndex].id, sort_order: node.sort_order }
      ];

      const response = await fetch('/api/admin/org/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ type: 'department', items })
      });

      if (response.ok) {
        await loadDepartments();
      }
    } catch (error) {
      alert('排序失败: ' + error);
    }
  };

  const handleEdit = (node: DepartmentNode) => {
    const newName = prompt('请输入新的部门名称:', node.name);
    if (newName && newName !== node.name) {
      fetch(`/api/admin/org/departments/${node.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ name: newName })
      })
        .then(res => res.ok ? loadDepartments() : Promise.reject())
        .catch(() => alert('编辑失败'));
    }
  };

  const handleDelete = async (node: DepartmentNode) => {
    if (!confirm(`确定要删除部门 "${node.name}" 吗?`)) return;
    
    try {
      const response = await fetch(`/api/admin/org/departments/${node.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });

      if (response.ok) {
        await loadDepartments();
        if (selectedDepartment === node.id) {
          setSelectedDepartment(null);
        }
      } else {
        const data = await response.json();
        alert(data.message || '删除失败');
      }
    } catch (error) {
      alert('删除失败: ' + error);
    }
  };

  const handleAdd = (parentId: string | null) => {
    const code = prompt('请输入部门代码:');
    if (!code) return;
    
    const name = prompt('请输入部门名称:');
    if (!name) return;

    fetch('/api/admin/org/departments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ code, name, parent_id: parentId, sort_order: 0 })
    })
      .then(res => res.ok ? loadDepartments() : Promise.reject())
      .catch(() => alert('添加失败'));
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [selectedDepartment, filter, searchQuery]);

  useEffect(() => {
    loadUnits();
  }, [selectedDepartment, searchQuery, filter, page]);

  useEffect(() => {
    if (selectedUnitId) {
      loadUnitDetail(selectedUnitId);
    } else {
      setUnitDetail(null);
    }
  }, [selectedUnitId]);

  const selectedDepartmentLabel = useMemo(() => {
    const found = departments.find((dept) => dept.id === selectedDepartment);
    return found ? `${found.name} (${found.code})` : '全部部门';
  }, [departments, selectedDepartment]);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/')}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors flex items-center gap-2 group"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span className="font-bold text-slate-700">返回工作台</span>
          </button>
          <div className="h-6 w-px bg-slate-200 mx-2"></div>
          <div className="flex items-center gap-2 text-slate-800">
            <Settings className="w-5 h-5 text-brand-600" />
            <span className="font-bold text-lg">系统管理后台</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full font-medium border border-brand-100">
            当前预算年度: {DEFAULT_YEAR}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_350px] gap-6 flex-1 min-h-0 items-start">
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden animate-fade-in" style={{ animationDelay: '0ms' }}>
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
             <h2 className="font-bold text-slate-800 flex items-center gap-2">
               <div className="w-1 h-4 bg-brand-600 rounded-full"></div>
               部门架构
             </h2>
             <button
               onClick={() => setShowImportModal(true)}
               className="p-2 hover:bg-brand-50 text-brand-600 rounded-lg transition-colors"
               title="批量导入"
             >
               <Upload className="w-4 h-4" />
             </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <DepartmentTree
              departments={departments}
              selectedId={selectedDepartment}
              onSelect={(id) => {
                setSelectedDepartment(id);
                setSelectedUnitId(null);
              }}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onReorder={handleReorder}
            />
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <div className="w-1 h-4 bg-brand-600 rounded-full"></div>
              单位列表
              <span className="text-sm font-normal text-slate-500 ml-2 bg-slate-100 px-2 py-0.5 rounded-full">
                 {selectedDepartmentLabel}
              </span>
            </h2>
            <div className="text-xs text-slate-400">
               共 {total} 条记录
            </div>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <UnitList
              units={units}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
              selectedUnitId={selectedUnitId}
              filter={filter}
              search={searchInput}
              onSearchChange={setSearchInput}
              onFilterChange={(nextFilter) => setFilter(nextFilter)}
              onPageChange={(nextPage) => setPage(nextPage)}
              onSelect={(id) => setSelectedUnitId(id)}
            />
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden animate-fade-in" style={{ animationDelay: '200ms' }}>
           <div className="p-4 border-b border-slate-100 bg-slate-50/50">
             <h2 className="font-bold text-slate-800 flex items-center gap-2">
               <div className="w-1 h-4 bg-brand-600 rounded-full"></div>
               单位详情
             </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <UnitDetailPanel unit={unitDetail} year={DEFAULT_YEAR} />
          </div>
        </section>

        {showImportModal && (
          <OrgImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImportSuccess={() => {
              loadDepartments();
              loadUnits();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AdminConsole;
