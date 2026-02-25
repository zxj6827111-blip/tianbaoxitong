import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: string | null;
  roles: string[];
  department_id: string | null;
  department_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  managed_unit_ids?: string[];
  managed_unit_names?: string[];
  can_create_budget?: boolean;
  can_create_final?: boolean;
}

interface DepartmentRow {
  id: string;
  name: string;
}

interface UnitRow {
  id: string;
  name: string;
  department_id: string;
}

interface UserManagementProps {
  isOpen: boolean;
  onClose: () => void;
}

type FormState = {
  username: string;
  password: string;
  role: string;
  department_id: string;
  managed_unit_ids: string[];
  can_create_budget: boolean;
  can_create_final: boolean;
};

const EMPTY_FORM: FormState = {
  username: '',
  password: '',
  role: 'reporter',
  department_id: '',
  managed_unit_ids: [],
  can_create_budget: true,
  can_create_final: true
};

const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  maintainer: '维护管理员',
  reporter: '主账号',
  viewer: '精准账号'
};

const UserManagement: React.FC<UserManagementProps> = ({ isOpen, onClose }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [unitsByDepartment, setUnitsByDepartment] = useState<Record<string, UnitRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const currentUnits = useMemo(
    () => unitsByDepartment[form.department_id] || [],
    [unitsByDepartment, form.department_id]
  );

  const loadBaseData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, deptRes] = await Promise.all([
        apiClient.listAdminUsers(),
        apiClient.getDepartments()
      ]);
      setUsers(Array.isArray(usersRes.users) ? usersRes.users : []);
      setDepartments(Array.isArray(deptRes.departments) ? deptRes.departments : []);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '加载用户管理数据失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUnitsByDepartmentId = async (departmentId: string): Promise<UnitRow[]> => {
    if (!departmentId) return [];
    if (unitsByDepartment[departmentId]) {
      return unitsByDepartment[departmentId];
    }
    try {
      const response = await apiClient.getUnits({ page: 1, pageSize: 500, department_id: departmentId });
      const units = Array.isArray(response.units)
        ? response.units.map((unit: any) => ({
            id: String(unit.id),
            name: String(unit.name || ''),
            department_id: String(unit.department_id || '')
          }))
        : [];
      setUnitsByDepartment((prev) => ({
        ...prev,
        [departmentId]: units
      }));
      return units;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadBaseData();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !form.department_id) return;
    void loadUnitsByDepartmentId(form.department_id);
  }, [form.department_id, isOpen]);

  if (!isOpen) return null;

  const closeForm = () => {
    setFormOpen(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setSubmitting(false);
  };

  const openCreateForm = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEditForm = async (user: UserRow) => {
    setEditingUser(user);
    const departmentId = user.department_id || '';
    let selectedManagedUnits: string[] = [];

    if (Array.isArray(user.managed_unit_ids) && user.managed_unit_ids.length > 0) {
      selectedManagedUnits = user.managed_unit_ids.map((id) => String(id));
    } else if (user.unit_id) {
      selectedManagedUnits = [String(user.unit_id)];
    }

    setForm({
      username: user.email || '',
      password: '',
      role: user.role || 'reporter',
      department_id: departmentId,
      managed_unit_ids: selectedManagedUnits,
      can_create_budget: user.can_create_budget !== false,
      can_create_final: user.can_create_final !== false
    });

    if (departmentId) {
      await loadUnitsByDepartmentId(departmentId);
    }
    setFormOpen(true);
  };

  const handleDepartmentChange = async (departmentId: string) => {
    if (!departmentId) {
      setForm((prev) => ({
        ...prev,
        department_id: '',
        managed_unit_ids: []
      }));
      return;
    }

    const units = await loadUnitsByDepartmentId(departmentId);
    setForm((prev) => ({
      ...prev,
      department_id: departmentId,
      managed_unit_ids: units.map((unit) => unit.id)
    }));
  };

  const toggleManagedUnit = (unitId: string, checked: boolean) => {
    setForm((prev) => {
      const next = new Set(prev.managed_unit_ids);
      if (checked) {
        next.add(unitId);
      } else {
        next.delete(unitId);
      }
      return {
        ...prev,
        managed_unit_ids: Array.from(next)
      };
    });
  };

  const selectAllManagedUnits = () => {
    setForm((prev) => ({
      ...prev,
      managed_unit_ids: currentUnits.map((unit) => unit.id)
    }));
  };

  const clearManagedUnits = () => {
    setForm((prev) => ({
      ...prev,
      managed_unit_ids: []
    }));
  };

  const saveUser = async () => {
    const username = form.username.trim();
    const password = form.password.trim();

    if (!username) {
      setError('请输入用户名');
      return;
    }
    if (!editingUser && !password) {
      setError('请输入密码');
      return;
    }
    if (!form.department_id) {
      setError('请选择部门');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        email: username,
        username,
        display_name: username,
        role: form.role,
        department_id: form.department_id || null,
        unit_id: form.managed_unit_ids[0] || null,
        managed_unit_ids: form.managed_unit_ids,
        can_create_budget: form.can_create_budget,
        can_create_final: form.can_create_final
      };

      if (editingUser) {
        if (password) {
          payload.password = password;
        }
        await apiClient.updateAdminUser(editingUser.id, payload);
      } else {
        payload.password = password;
        await apiClient.createAdminUser(payload);
      }

      await loadBaseData();
      closeForm();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '保存用户失败');
    } finally {
      setSubmitting(false);
    }
  };

  const removeUser = async (user: UserRow) => {
    const ok = confirm(`确认删除用户 ${user.email} 吗？此操作不可恢复。`);
    if (!ok) return;
    setError(null);
    try {
      await apiClient.deleteAdminUser(user.id);
      await loadBaseData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '删除用户失败');
    }
  };

  const renderManagedUnits = (user: UserRow) => {
    const names = Array.isArray(user.managed_unit_names) ? user.managed_unit_names.filter(Boolean) : [];
    if (names.length > 0) {
      return names.join('、');
    }

    const ids = Array.isArray(user.managed_unit_ids) ? user.managed_unit_ids : [];
    if (ids.length > 0) {
      return `共 ${ids.length} 个单位`;
    }

    return '-';
  };

  const renderRoleLabel = (role?: string | null) => {
    const normalized = String(role || '').trim().toLowerCase();
    if (!normalized) return '-';
    return ROLE_LABELS[normalized] || normalized;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden animate-slide-up">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">用户管理</h3>
            <p className="text-xs text-slate-500">新增用户已简化：用户名、密码、部门、单位勾选、权限勾选</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(92vh-150px)]">
          <div className="flex items-center justify-between">
            <button
              onClick={openCreateForm}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              新增用户
            </button>
            {loading && <span className="text-xs text-slate-500">加载中...</span>}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[220px_120px_180px_1fr_180px_120px] gap-2 px-4 py-3 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
              <div>用户名</div>
              <div>角色</div>
              <div>部门</div>
              <div>可管理单位</div>
              <div>创建权限</div>
              <div>操作</div>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {users.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-500">暂无用户数据</div>
              )}
              {users.map((user) => (
                <div key={user.id} className="grid grid-cols-[220px_120px_180px_1fr_180px_120px] gap-2 px-4 py-3 text-sm items-center">
                  <div className="font-medium text-slate-800 truncate" title={user.email}>{user.email}</div>
                  <div>
                    <span className="inline-flex px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs">{renderRoleLabel(user.role)}</span>
                  </div>
                  <div className="text-xs text-slate-700 truncate" title={user.department_name || ''}>{user.department_name || '-'}</div>
                  <div className="text-xs text-slate-700 truncate" title={renderManagedUnits(user)}>{renderManagedUnits(user)}</div>
                  <div className="text-xs text-slate-700">
                    {(user.can_create_budget !== false ? '预算' : '') || '-'}
                    {user.can_create_budget !== false && user.can_create_final !== false ? ' / ' : ''}
                    {user.can_create_final !== false ? '决算' : ''}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => void openEditForm(user)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="编辑">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => void removeUser(user)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="删除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {formOpen && (
          <div className="fixed inset-0 z-[60] bg-black/40 overflow-y-auto">
            <div className="min-h-full w-full flex items-start justify-center p-4 sm:p-6">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <h4 className="font-bold text-slate-900">{editingUser ? '编辑用户' : '新增用户'}</h4>
                <button onClick={closeForm} className="p-1.5 rounded hover:bg-slate-100 text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-700">
                    用户名
                    <input
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={form.username}
                      onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    密码 {editingUser ? '(留空则不修改)' : ''}
                    <input
                      type="password"
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={form.password}
                      onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-700">
                    部门
                    <select
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                      value={form.department_id}
                      onChange={(event) => {
                        void handleDepartmentChange(event.target.value);
                      }}
                    >
                      <option value="">-- 请选择部门 --</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>{department.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    角色（默认主账号）
                    <input
                      readOnly
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-slate-50 text-slate-600"
                      value={form.role === 'reporter' ? '主账号（默认最高权限）' : renderRoleLabel(form.role)}
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-medium text-slate-800">创建权限（勾选）</p>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.can_create_budget}
                        onChange={(event) => setForm((prev) => ({ ...prev, can_create_budget: event.target.checked }))}
                      />
                      可创建预算报告
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.can_create_final}
                        onChange={(event) => setForm((prev) => ({ ...prev, can_create_final: event.target.checked }))}
                      />
                      可创建决算报告
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-medium text-slate-800">下属单位（勾选后可管理）</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllManagedUnits}
                        className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                        disabled={currentUnits.length === 0}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={clearManagedUnits}
                        className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                        disabled={form.managed_unit_ids.length === 0}
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  {!form.department_id ? (
                    <p className="text-xs text-slate-500">请先选择部门</p>
                  ) : currentUnits.length === 0 ? (
                    <p className="text-xs text-slate-500">该部门暂无可选单位</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto grid grid-cols-2 gap-2">
                      {currentUnits.map((unit) => {
                        const checked = form.managed_unit_ids.includes(unit.id);
                        return (
                          <label key={unit.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => toggleManagedUnit(unit.id, event.target.checked)}
                            />
                            <span className="truncate" title={unit.name}>{unit.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 shrink-0">
                <button onClick={closeForm} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200">
                  取消
                </button>
                <button
                  onClick={saveUser}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {submitting ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserManagement;
