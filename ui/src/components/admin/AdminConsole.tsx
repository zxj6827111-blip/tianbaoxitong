import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DepartmentTree from './DepartmentTree';
import UnitList from './UnitList';
import UnitDetailPanel from './UnitDetail';
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
      const response = await fetch(`/api/admin/departments?year=${DEFAULT_YEAR}`);
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
      const response = await fetch(`/api/admin/units?${params.toString()}`);
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
      const response = await fetch(`/api/admin/units/${unitId}?year=${DEFAULT_YEAR}`);
      if (!response.ok) {
        throw new Error('Failed');
      }
      const data = await response.json();
      setUnitDetail(data.unit ?? null);
    } catch (error) {
      setUnitDetail({ ...mockUnitDetail, id: unitId });
    }
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
    <div className="admin-grid">
      <section className="panel">
        <h2>部门树</h2>
        <DepartmentTree
          departments={departments}
          selectedId={selectedDepartment}
          onSelect={(id) => {
            setSelectedDepartment(id);
            setSelectedUnitId(null);
          }}
        />
      </section>
      <section className="panel">
        <h2>单位列表 · {selectedDepartmentLabel}</h2>
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
      </section>
      <section className="panel">
        <UnitDetailPanel unit={unitDetail} />
      </section>
    </div>
  );
};

export default AdminConsole;
