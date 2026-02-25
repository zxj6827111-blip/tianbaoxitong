import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';
import ArchivePanel from '../components/admin/ArchivePanel';
import { DepartmentNode } from '../data/mockAdminData';

const CURRENT_YEAR = new Date().getFullYear();

const parseSearchYear = (value: string | null) => {
  if (!value) return CURRENT_YEAR;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900) {
    return CURRENT_YEAR;
  }
  return parsed;
};

const AdminDepartmentDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { departmentId } = useParams<{ departmentId: string }>();
  const [searchParams] = useSearchParams();
  const budgetYear = parseSearchYear(searchParams.get('year'));
  const [archiveYear, setArchiveYear] = useState<number>(budgetYear - 1);
  const [department, setDepartment] = useState<DepartmentNode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setArchiveYear(budgetYear - 1);
  }, [budgetYear]);

  useEffect(() => {
    if (!departmentId) {
      setDepartment(null);
      setLoading(false);
      return;
    }

    const loadDepartmentDetail = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/departments/${departmentId}?year=${budgetYear}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
        });
        if (!response.ok) throw new Error('Failed to fetch department detail');
        const data = await response.json();
        const nextDepartment: DepartmentNode | null = data.department ?? null;
        setDepartment(nextDepartment);
      } catch (error) {
        console.error('Failed to load department detail:', error);
        setDepartment(null);
      } finally {
        setLoading(false);
      }
    };

    loadDepartmentDetail();
  }, [departmentId, budgetYear]);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
      <div className="flex items-center bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors flex items-center gap-2 group"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span className="font-bold text-slate-700">返回系统后台</span>
          </button>
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <div className="flex items-center gap-2 text-slate-800">
            <Settings className="w-5 h-5 text-brand-600" />
            <span className="font-bold text-lg">部门详情（独立页面）</span>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">正在加载部门详情...</div>
          ) : !department ? (
            <div className="p-6 text-sm text-slate-500">未找到该部门信息。</div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 border border-slate-200 rounded-lg bg-white">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-slate-900">{department.name}</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500 font-mono text-xs">
                      {department.code}
                    </span>
                    <span className="text-xs text-slate-500">下属单位 {department.total_units} 个</span>
                    <span className="text-xs text-slate-500">待处理 {department.todo_units} 个</span>
                  </div>
                </div>
              </div>

              <div className="p-4 border border-slate-200 rounded-lg bg-white">
                <ArchivePanel
                  departmentId={department.id}
                  archiveScope="department"
                  year={archiveYear}
                  onYearChange={setArchiveYear}
                />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminDepartmentDetailPage;
