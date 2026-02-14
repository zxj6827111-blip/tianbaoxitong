import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Settings, Upload } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';
import DepartmentTree from './DepartmentTree';
import UnitList from './UnitList';
import OrgImportModal from './OrgImportModal';
import { DepartmentNode, UnitRow } from '../../data/mockAdminData';

const DEFAULT_PAGE_SIZE = 10;
const CURRENT_YEAR = new Date().getFullYear();

const parseSearchYear = (value: string | null) => {
  if (!value) return CURRENT_YEAR;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900) {
    return CURRENT_YEAR;
  }
  return parsed;
};

const AdminConsole: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);

  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(searchParams.get('filter'));
  const [budgetYear, setBudgetYear] = useState<number>(parseSearchYear(searchParams.get('year')));

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [showImportModal, setShowImportModal] = useState(false);
  const [viewMode, setViewMode] = useState<'units' | 'department'>('units');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');

  useEffect(() => {
    const handler = window.setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(handler);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('year', String(budgetYear));
    if (filter) params.set('filter', filter);
    setSearchParams(params, { replace: true });
  }, [budgetYear, filter, setSearchParams]);

  const loadDepartments = async () => {
    try {
      const data = await apiClient.getDepartments(budgetYear);
      setDepartments(data.departments ?? []);
    } catch (error) {
      console.error('Failed to load departments:', error);
      setDepartments([]);
    }
  };

  const loadUnits = async () => {
    try {
      const params: any = {
        year: budgetYear,
        page,
        pageSize: DEFAULT_PAGE_SIZE
      };
      if (selectedDepartment) params.department_id = selectedDepartment;
      if (searchQuery) params.q = searchQuery;
      if (filter) params.filter = filter;

      const data = await apiClient.getUnits(params);
      setUnits(data.units ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      console.error('Failed to load units:', error);
      setUnits([]);
      setTotal(0);
    }
  };

  const handleReorder = async (node: DepartmentNode, direction: 'up' | 'down') => {
    try {
      const siblings = departments.filter((item) => item.parent_id === node.parent_id);
      const currentIndex = siblings.findIndex((item) => item.id === node.id);
      if ((direction === 'up' && currentIndex === 0) || (direction === 'down' && currentIndex === siblings.length - 1)) {
        return;
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
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ type: 'department', items })
      });

      if (response.ok) await loadDepartments();
    } catch (error) {
      alert(`排序失败: ${error}`);
    }
  };

  const handleEdit = (node: DepartmentNode) => {
    const newName = prompt('请输入新的部门名称', node.name);
    if (!newName || newName === node.name) return;

    fetch(`/api/admin/org/departments/${node.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({ name: newName })
    })
      .then((res) => (res.ok ? loadDepartments() : Promise.reject()))
      .catch(() => alert('编辑失败'));
  };

  const handleDelete = async (node: DepartmentNode) => {
    if (!confirm(`确定要删除部门“${node.name}”吗？`)) return;
    try {
      const deleteDept = async (force: boolean = false) => {
        const response = await fetch(`/api/admin/org/departments/${node.id}${force ? '?force=true' : ''}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
        });

        if (response.ok) {
          await loadDepartments();
          if (selectedDepartment === node.id) setSelectedDepartment(null);
        } else {
          const data = await response.json();
          if (data.code === 'DEPARTMENT_HAS_UNITS') {
            if (confirm(`该部门下包含 ${data.unitCount} 个单位，是否强制删除？\n\n警告：这将永久删除该部门下所有单位及相关数据（上传文件、审改建议、归档记录等），此操作不可恢复！`)) {
              await deleteDept(true);
            }
          } else {
            alert(data.message || '删除失败');
          }
        }
      };

      await deleteDept(false);
    } catch (error) {
      alert(`删除失败: ${error}`);
    }
  };

  const handleAdd = async (parentId: string | null) => {
    const name = prompt('请输入部门名称');
    if (!name) return;

    try {
      const response = await fetch('/api/admin/org/departments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ name, parent_id: parentId, sort_order: 0 })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || response.statusText || 'Create failed');
      }

      await loadDepartments();
    } catch (error: any) {
      alert(`添加失败: ${error?.message || error}`);
    }
  };

  const handleDeleteUnit = async (unit: UnitRow) => {
    if (!confirm(`确定要删除单位“${unit.name}”吗？`)) return;
    try {
      const response = await fetch(`/api/admin/org/units/${unit.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
      });

      if (response.ok) {
        await loadUnits();
      } else {
        const data = await response.json().catch(() => ({}));
        const errorMsg = data.message || response.statusText || '';
        if (errorMsg.includes('foreign key')) {
          alert('删除失败：该单位已有关联数据（如上传文件、预算记录等），无法直接删除。\n\n如需删除，请先清理相关数据。');
        } else {
          alert(`删除失败: ${errorMsg}`);
        }
      }
    } catch (error) {
      alert(`删除失败: ${error}`);
    }
  };

  const handleAddUnit = () => {
    if (!selectedDepartment) {
      alert('请先选择一个部门');
      return;
    }

    const name = prompt('请输入单位名称');
    if (!name) return;

    fetch('/api/admin/org/units', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({ name, department_id: selectedDepartment, sort_order: 0 })
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || res.statusText || 'Create failed');
        }
        return res.json();
      })
      .then(() => loadUnits())
      .catch((error) => alert(`添加失败: ${error.message}`));
  };

  const handleEditUnit = (unit: UnitRow) => {
    const newName = prompt('请输入新的单位名称', unit.name);
    if (!newName || newName === unit.name) return;

    fetch(`/api/admin/org/units/${unit.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({ name: newName })
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Update failed');
        await loadUnits();
      })
      .catch(() => alert('编辑失败'));
  };

  useEffect(() => {
    loadDepartments();
  }, [budgetYear]);

  useEffect(() => {
    setPage(1);
  }, [budgetYear, selectedDepartment, filter, searchQuery]);

  useEffect(() => {
    loadUnits();
  }, [budgetYear, selectedDepartment, searchQuery, filter, page]);

  const selectedDepartmentLabel = useMemo(() => {
    const found = departments.find((dept) => dept.id === selectedDepartment);
    return found ? `${found.name} (${found.code})` : '全部部门';
  }, [departments, selectedDepartment]);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
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
          <label className="flex items-center gap-2 px-3 py-1 bg-brand-50 text-brand-700 rounded-full font-medium border border-brand-100">
            <span>当前预算年度</span>
            <select
              value={budgetYear}
              onChange={(event) => setBudgetYear(Number(event.target.value))}
              className="bg-white border border-brand-200 rounded px-2 py-0.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {Array.from({ length: 7 }, (_, index) => CURRENT_YEAR + 1 - index).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(520px,1fr)] gap-4 flex-1 min-h-0 items-start">
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
              onSelect={(id) => setSelectedDepartment(id)}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onReorder={handleReorder}
              selectedDistrict={selectedDistrict}
              onDistrictChange={setSelectedDistrict}
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
            <div className="text-xs text-slate-400">共 {total} 条记录，点击单位进入详情页</div>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <UnitList
              units={units}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
              selectedUnitId={null}
              filter={filter}
              search={searchInput}
              onSearchChange={setSearchInput}
              onFilterChange={(nextFilter) => setFilter(nextFilter)}
              onPageChange={(nextPage) => setPage(nextPage)}
              onSelect={(id) => navigate(`/admin/unit/${id}?year=${budgetYear}`)}
              onDelete={handleDeleteUnit}
              onEdit={handleEditUnit}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onAddUnit={handleAddUnit}
            />
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
