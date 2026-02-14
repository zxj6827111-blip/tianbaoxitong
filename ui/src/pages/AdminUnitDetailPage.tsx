import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';
import UnitDetailPanel from '../components/admin/UnitDetail';
import { UnitDetail } from '../data/mockAdminData';

const CURRENT_YEAR = new Date().getFullYear();

const parseSearchYear = (value: string | null) => {
  if (!value) return CURRENT_YEAR;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900) {
    return CURRENT_YEAR;
  }
  return parsed;
};

const AdminUnitDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { unitId } = useParams<{ unitId: string }>();
  const [searchParams] = useSearchParams();
  const budgetYear = parseSearchYear(searchParams.get('year'));
  const [unitDetail, setUnitDetail] = useState<UnitDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!unitId) {
      setUnitDetail(null);
      setLoading(false);
      return;
    }

    const loadUnitDetail = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/units/${unitId}?year=${budgetYear}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
        });
        if (!response.ok) throw new Error('Failed to fetch unit detail');
        const data = await response.json();
        setUnitDetail(data.unit ?? null);
      } catch (error) {
        console.error('Failed to load unit detail:', error);
        setUnitDetail(null);
      } finally {
        setLoading(false);
      }
    };

    loadUnitDetail();
  }, [unitId, budgetYear]);

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
            <span className="font-bold text-lg">单位详情（独立页面）</span>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">正在加载单位详情...</div>
          ) : (
            <UnitDetailPanel unit={unitDetail} year={budgetYear} />
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminUnitDetailPage;

