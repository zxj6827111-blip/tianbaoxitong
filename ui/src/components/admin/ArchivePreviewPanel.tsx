import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, RefreshCcw, Table2, List, Trash2 } from 'lucide-react';
import TableDataViewer from './TableDataViewer';

type BatchStatus = 'PENDING_REVIEW' | 'REVIEWED' | 'COMMITTED' | 'REJECTED';
type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRECOGNIZED';
type AliasStatus = 'CANDIDATE' | 'APPROVED' | 'REJECTED';

interface ReportSummary {
  id: string;
  report_type: 'BUDGET' | 'FINAL';
  file_name: string;
  created_at?: string;
}

interface BatchRow {
  id: string;
  report_id: string;
  file_name: string;
  report_type: 'BUDGET' | 'FINAL';
  status: BatchStatus;
  created_at: string;
  field_count?: number;
  issue_count?: number;
}

interface FieldRow {
  id: string;
  batch_id: string;
  key: string;
  normalized_value: number | null;
  corrected_value: number | null;
  confidence: Confidence;
  confirmed: boolean;
  raw_text_snippet: string | null;
}

interface IssueRow {
  id: string;
  level: 'ERROR' | 'WARN';
  message: string;
  rule_id: string;
  evidence?: Record<string, unknown> | null;
}

interface TableData {
  id: string;
  table_key: string;
  table_title: string | null;
  page_numbers: number[] | null;
  row_count: number;
  col_count: number;
  data_json: string[][] | null;
}

interface OcrSkippedItem {
  table_key: string | null;
  reason: string | null;
  page_no?: number | null;
}

interface OcrSummary {
  enabled: boolean;
  executed: boolean;
  reason: string | null;
  suspicious_table_keys?: string[];
  processed_tables?: string[];
  skipped_tables?: OcrSkippedItem[];
  matched_count?: number;
  mock_mode?: boolean;
}

interface BatchDetail {
  batch: BatchRow;
  fields: FieldRow[];
  issues: IssueRow[];
  tables?: TableData[];
  ocr_summary?: OcrSummary | null;
}

interface AliasRow {
  id: string;
  raw_label: string;
  normalized_label: string;
  resolved_key: string;
  status: AliasStatus;
  updated_at: string;
}

interface FieldDraft {
  corrected: string;
  confirmed: boolean;
}

interface Props {
  unitId: string;
  year: number;
  reports: ReportSummary[];
  refreshKey?: number;
  focusBatchId?: string | null;
  onCommitted?: () => void;
  onReportDeleted?: () => void;
}

const ISSUE_LIMIT = 8;
const LOW_CONFIDENCE_SET = new Set<Confidence>(['LOW', 'UNRECOGNIZED']);

const STATUS_LABEL: Record<BatchStatus, string> = {
  PENDING_REVIEW: '待确认',
  REVIEWED: '已复核',
  COMMITTED: '已入库',
  REJECTED: '已驳回'
};

const STATUS_STYLE: Record<BatchStatus, string> = {
  PENDING_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
  REVIEWED: 'bg-sky-50 text-sky-700 border-sky-200',
  COMMITTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-slate-100 text-slate-600 border-slate-200'
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
  UNRECOGNIZED: '未识别'
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  HIGH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-sky-50 text-sky-700 border-sky-200',
  LOW: 'bg-amber-50 text-amber-700 border-amber-200',
  UNRECOGNIZED: 'bg-rose-50 text-rose-700 border-rose-200'
};

const OCR_REASON_LABEL: Record<string, string> = {
  NO_SUSPICIOUS_TABLES: '未触发（无可疑表）',
  OCR_DISABLED: '未执行（OCR已关闭）',
  OCR_BINARY_MISSING: '未执行（OCR依赖缺失）',
  PDF_NOT_FOUND: '未执行（找不到PDF文件）',
  OCR_NO_OUTPUT: '执行了OCR但无有效输出',
  OCR_APPLIED: 'OCR已执行并产出文本',
  MOCK_OCR: 'OCR模拟模式',
  MOCK_NO_MATCH: 'OCR模拟模式（无匹配）'
};

const RULE_LABEL: Record<string, string> = {
  'ARCHIVE.FIELD_COVERAGE': '必填字段缺失',
  'ARCHIVE.BALANCE_REVENUE_EXPENDITURE': '收支总额不平衡',
  'ARCHIVE.BALANCE_EXPENDITURE_COMPONENTS': '支出构成不平衡',
  'ARCHIVE.BALANCE_FISCAL_GRANT': '财政拨款收支不平衡',
  'ARCHIVE.YOY_ANOMALY': '同比异常',
  'ARCHIVE.MANUAL_CONFLICT': '手工值冲突',
  'ARCHIVE.UNMATCHED_LABEL': '标签未匹配'
};

const FIELD_LABEL: Record<string, string> = {
  budget_revenue_total: '收入预算合计（万元）',
  budget_revenue_fiscal: '财政拨款收入（万元）',
  budget_revenue_business: '事业收入（万元）',
  budget_revenue_operation: '事业单位经营收入（万元）',
  budget_revenue_other: '其他收入（万元）',
  budget_expenditure_total: '支出预算合计（万元）',
  budget_expenditure_basic: '基本支出（万元）',
  budget_expenditure_project: '项目支出（万元）',
  fiscal_grant_revenue_total: '财政拨款收入合计（万元）',
  fiscal_grant_expenditure_total: '财政拨款支出合计（万元）',
  fiscal_grant_expenditure_general: '一般公共预算财政拨款支出（万元）',
  fiscal_grant_expenditure_gov_fund: '政府性基金预算财政拨款支出（万元）',
  fiscal_grant_expenditure_capital: '国有资本经营预算财政拨款支出（万元）',
  three_public_total: '三公经费合计（万元）',
  three_public_outbound: '因公出国（境）费（万元）',
  three_public_vehicle_total: '公务用车购置及运行费（万元）',
  three_public_vehicle_purchase: '公务用车购置费（万元）',
  three_public_vehicle_operation: '公务用车运行费（万元）',
  three_public_reception: '公务接待费（万元）',
  operation_fund: '机关运行经费预算数（万元）'
};

const ALIAS_STATUS_LABEL: Record<AliasStatus, string> = {
  CANDIDATE: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回'
};

const readError = async (res: Response) => {
  const fallback = `请求失败（${res.status}）`;
  try {
    const data = await res.json();
    return String(data?.message || data?.error || fallback);
  } catch {
    return fallback;
  }
};

const prettifyError = (message: string) => {
  const text = String(message || '');
  if (/archive_preview_batch/i.test(text)) {
    return '解析确认功能尚未初始化，请先执行数据库迁移：npm run db:migrate。';
  }
  if (/custom_alias_mapping/i.test(text)) {
    return '别名审核功能尚未初始化，请先执行数据库迁移：npm run db:migrate。';
  }
  return text || '请求失败';
};

const toInput = (value: number | null | undefined) => (Number.isFinite(Number(value)) ? String(value) : '');
const toNumberOrNull = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const nearlyEqual = (left: number | null, right: number | null) => {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= 0.0001;
};

const fmtTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN');
};

const reportTypeLabel = (type: 'BUDGET' | 'FINAL') => (type === 'BUDGET' ? '预算' : '决算');

const formatIssueMessage = (issue: IssueRow) => {
  const raw = String(issue.message || '').trim();
  const inline = raw.match(/^(WARN|ERROR)\s+([A-Z0-9._-]+)\s*:\s*(.*)$/);
  if (inline) {
    const ruleName = RULE_LABEL[inline[2]] || inline[2];
    return inline[3] ? `${ruleName}：${inline[3]}` : ruleName;
  }
  if (raw) return raw;
  return RULE_LABEL[issue.rule_id] || issue.rule_id || '-';
};

const fmtNum = (v: unknown) => {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
};

const formatOcrReason = (reason: string | null | undefined) => {
  const key = String(reason || '').trim();
  if (!key) return '未知';
  return OCR_REASON_LABEL[key] || key;
};

const formatSkippedTable = (item: OcrSkippedItem) => {
  const table = item.table_key || '-';
  const reason = formatOcrReason(item.reason);
  const page = Number.isFinite(Number(item.page_no)) ? ` / page ${item.page_no}` : '';
  return `${table} / ${reason}${page}`;
};

const buildEvidenceLines = (issue: IssueRow): string[] => {
  const ev = issue.evidence;
  if (!ev) return [];
  const lines: string[] = [];

  if (issue.rule_id === 'ARCHIVE.BALANCE_REVENUE_EXPENDITURE') {
    lines.push(`收入预算合计 = ${fmtNum(ev.budget_revenue_total)} 万元`);
    lines.push(`支出预算合计 = ${fmtNum(ev.budget_expenditure_total)} 万元`);
    lines.push(`差额 = ${fmtNum(ev.diff)} 万元`);
    lines.push(`💡 请修正其中一方使收支相等`);
  } else if (issue.rule_id === 'ARCHIVE.BALANCE_EXPENDITURE_COMPONENTS') {
    lines.push(`支出预算合计 = ${fmtNum(ev.budget_expenditure_total)} 万元`);
    lines.push(`基本支出 (${fmtNum(ev.budget_expenditure_basic)}) + 项目支出 (${fmtNum(ev.budget_expenditure_project)}) = ${fmtNum(ev.components_sum)} 万元`);
    lines.push(`差额 = ${fmtNum(ev.diff)} 万元`);
    const total = Number(ev.budget_expenditure_total);
    const basic = Number(ev.budget_expenditure_basic);
    const project = Number(ev.budget_expenditure_project);
    if (Number.isFinite(total) && Number.isFinite(basic) && Number.isFinite(project)) {
      if (basic === 0 && project < total) {
        lines.push(`💡 建议：基本支出可能应为 ${fmtNum(total - project)} 万元`);
      } else if (project === 0 && basic < total) {
        lines.push(`💡 建议：项目支出可能应为 ${fmtNum(total - basic)} 万元`);
      } else {
        lines.push(`💡 请检查基本支出或项目支出的数值是否正确`);
      }
    }
  } else if (issue.rule_id === 'ARCHIVE.BALANCE_FISCAL_GRANT') {
    lines.push(`财政拨款收入合计 = ${fmtNum(ev.fiscal_grant_revenue_total)} 万元`);
    lines.push(`财政拨款支出合计 = ${fmtNum(ev.fiscal_grant_expenditure_total)} 万元`);
    lines.push(`差额 = ${fmtNum(ev.diff)} 万元`);
    lines.push(`💡 请修正其中一方使收支相等`);
  } else if (issue.rule_id === 'ARCHIVE.FIELD_COVERAGE') {
    const missing = Array.isArray(ev.missing_keys) ? ev.missing_keys : [];
    for (const key of missing) {
      lines.push(`缺失：${FIELD_LABEL[key as string] || key}`);
    }
    lines.push(`💡 请在下方字段表中补填上述字段的修正值`);
  } else if (issue.rule_id === 'ARCHIVE.UNMATCHED_LABEL') {
    if (ev.raw_label) lines.push(`原始标签：${String(ev.raw_label)}`);
    if (ev.normalized_label) lines.push(`归一化：${String(ev.normalized_label)}`);
    lines.push('💡 这类告警仅提示标签未识别，不会直接阻塞入库');
  } else if (issue.rule_id === 'ARCHIVE.MANUAL_CONFLICT') {
    const label = FIELD_LABEL[ev.key as string] || ev.key;
    lines.push(`字段：${label}`);
    lines.push(`结构化结果 = ${fmtNum(ev.auto_value)} 万元`);
    lines.push(`手工解析值 = ${fmtNum(ev.manual_value)} 万元`);
    if (ev.normalized_manual_value !== undefined) {
      lines.push(`手工值归一化后 = ${fmtNum(ev.normalized_manual_value)} 万元`);
    }
    if (ev.normalize_reason) {
      lines.push(`归一化原因：${String(ev.normalize_reason)}`);
    }
    lines.push('💡 仅当该冲突导致必填字段缺失或平衡校验失败时才会阻塞入库');
  } else if (issue.rule_id === 'ARCHIVE.YOY_ANOMALY') {
    const label = FIELD_LABEL[ev.key as string] || ev.key;
    lines.push(`${label}：本年 ${fmtNum(ev.current)} → 上年 ${fmtNum(ev.previous)}  (偏差 ${((Number(ev.ratio) || 0) * 100).toFixed(1)}%)`);
  }
  return lines;
};

const ArchivePreviewPanel: React.FC<Props> = ({
  unitId,
  year,
  reports,
  refreshKey = 0,
  focusBatchId = null,
  onCommitted,
  onReportDeleted
}) => {
  const token = localStorage.getItem('auth_token') || '';
  const authOnly = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const authJson = useMemo(() => ({ ...authOnly, 'Content-Type': 'application/json' }), [authOnly]);

  const [statusFilter, setStatusFilter] = useState('');
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [originalDrafts, setOriginalDrafts] = useState<Record<string, FieldDraft>>({});
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [quickConfirming, setQuickConfirming] = useState(false);
  const [busyCommit, setBusyCommit] = useState(false);
  const [busyReject, setBusyReject] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);

  const [showOnlyNeedReview, setShowOnlyNeedReview] = useState(false);
  const [expandIssues, setExpandIssues] = useState(false);
  const [viewMode, setViewMode] = useState<'fields' | 'tables'>('fields');

  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [creatingBulk, setCreatingBulk] = useState(false);

  const [aliasStatus, setAliasStatus] = useState<AliasStatus>('CANDIDATE');
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loadingAliases, setLoadingAliases] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [updatingAliasId, setUpdatingAliasId] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isFieldChanged = (fieldId: string) => {
    const current = drafts[fieldId];
    const original = originalDrafts[fieldId];
    if (!current || !original) return false;
    const currentNum = toNumberOrNull(current.corrected);
    const originalNum = toNumberOrNull(original.corrected);
    return !nearlyEqual(currentNum, originalNum) || current.confirmed !== original.confirmed;
  };

  const loadBatches = async (preferredId?: string | null) => {
    setLoadingBatches(true);
    setBatchError(null);
    try {
      const params = new URLSearchParams();
      params.set('unit_id', unitId);
      params.set('year', String(year));
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/admin/archives/preview?${params.toString()}`, { headers: authOnly });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));

      const data: { batches?: BatchRow[] } = await res.json();
      const next = Array.isArray(data.batches) ? data.batches : [];
      setBatches(next);

      if (preferredId) {
        setActiveBatchId(preferredId);
      } else if (activeBatchId && !next.some((item) => item.id === activeBatchId)) {
        setActiveBatchId(next[0]?.id || null);
      } else if (!activeBatchId && next[0]?.id) {
        setActiveBatchId(next[0].id);
      }
    } catch (error) {
      setBatches([]);
      setBatchError(error instanceof Error ? error.message : '加载批次失败');
    } finally {
      setLoadingBatches(false);
    }
  };

  const loadDetail = async (batchId: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/archives/preview/${batchId}`, { headers: authOnly });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));
      const data: BatchDetail = await res.json();
      setDetail(data);

      const nextDrafts: Record<string, FieldDraft> = {};
      for (const field of data.fields || []) {
        nextDrafts[field.id] = {
          corrected: toInput(field.corrected_value ?? field.normalized_value),
          confirmed: Boolean(field.confirmed)
        };
      }
      setDrafts(nextDrafts);
      setOriginalDrafts(nextDrafts);
      setExpandIssues(false);
    } catch (error) {
      setDetail(null);
      setDrafts({});
      setOriginalDrafts({});
      setDetailError(error instanceof Error ? error.message : '加载详情失败');
    } finally {
      setLoadingDetail(false);
    }
  };

  const loadAliases = async () => {
    setLoadingAliases(true);
    setAliasError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', aliasStatus);
      params.set('limit', '100');

      const res = await fetch(`/api/admin/archives/alias-mappings?${params.toString()}`, { headers: authOnly });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));

      const data: { aliases?: AliasRow[] } = await res.json();
      setAliases(Array.isArray(data.aliases) ? data.aliases : []);
    } catch (error) {
      setAliases([]);
      setAliasError(error instanceof Error ? error.message : '加载别名失败');
    } finally {
      setLoadingAliases(false);
    }
  };

  useEffect(() => {
    void loadBatches(focusBatchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, year, statusFilter, refreshKey]);

  useEffect(() => {
    if (focusBatchId) setActiveBatchId(focusBatchId);
  }, [focusBatchId]);

  useEffect(() => {
    if (!activeBatchId) {
      setDetail(null);
      setDrafts({});
      setOriginalDrafts({});
      return;
    }
    void loadDetail(activeBatchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBatchId]);

  useEffect(() => {
    void loadAliases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliasStatus, refreshKey]);

  const clearActionHint = () => {
    setActionMessage(null);
    setActionError(null);
  };

  const toggleReport = (id: string) => {
    clearActionHint();
    setSelectedReportIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const createBulk = async () => {
    if (selectedReportIds.length === 0) {
      setActionError('请至少选择一个文件。');
      return;
    }
    clearActionHint();
    setCreatingBulk(true);
    try {
      const res = await fetch('/api/admin/archives/preview/bulk', {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({ report_ids: selectedReportIds, unit_id: unitId })
      });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));
      const data: { batches?: Array<{ batch_id: string }> } = await res.json();
      const first = data.batches?.[0]?.batch_id || null;
      setSelectedReportIds([]);
      await loadBatches(first);
      if (first) setActiveBatchId(first);
      setActionMessage(`已创建 ${data.batches?.length || 0} 个确认批次。`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '批量创建失败');
    } finally {
      setCreatingBulk(false);
    }
  };

  const patchField = async (fieldId: string, payload: { corrected_value: number | null; confirmed: boolean }) => {
    if (!activeBatchId) throw new Error('请选择批次');
    const res = await fetch(`/api/admin/archives/preview/${activeBatchId}/fields/${fieldId}`, {
      method: 'PATCH',
      headers: authJson,
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(prettifyError(await readError(res)));
    return res.json();
  };

  const saveField = async (fieldId: string) => {
    const draft = drafts[fieldId];
    if (!draft || !isFieldChanged(fieldId)) return;
    clearActionHint();
    setSavingFieldId(fieldId);
    try {
      await patchField(fieldId, {
        corrected_value: toNumberOrNull(draft.corrected),
        confirmed: draft.confirmed
      });
      if (activeBatchId) {
        await loadDetail(activeBatchId);
        await loadBatches(activeBatchId);
      }
      setActionMessage('字段已保存。');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '保存字段失败');
    } finally {
      setSavingFieldId(null);
    }
  };

  const saveAllChangedFields = async () => {
    if (!detail) return;
    const changed = detail.fields.filter((field) => isFieldChanged(field.id));
    if (changed.length === 0) {
      setActionMessage('当前没有待保存改动。');
      return;
    }
    clearActionHint();
    setBatchSaving(true);
    try {
      for (const field of changed) {
        const draft = drafts[field.id];
        if (!draft) continue;
        // eslint-disable-next-line no-await-in-loop
        await patchField(field.id, {
          corrected_value: toNumberOrNull(draft.corrected),
          confirmed: draft.confirmed
        });
      }
      if (activeBatchId) {
        await loadDetail(activeBatchId);
        await loadBatches(activeBatchId);
      }
      setActionMessage(`已保存 ${changed.length} 个字段。`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '批量保存失败');
    } finally {
      setBatchSaving(false);
    }
  };

  const quickConfirmLowConfidence = async () => {
    if (!detail) return;
    const target = detail.fields.filter((field) => LOW_CONFIDENCE_SET.has(field.confidence) && !drafts[field.id]?.confirmed);
    if (target.length === 0) {
      setActionMessage('当前没有待确认的低置信字段。');
      return;
    }
    clearActionHint();
    setQuickConfirming(true);
    try {
      for (const field of target) {
        const draft = drafts[field.id];
        const correctedValue = draft ? toNumberOrNull(draft.corrected) : field.corrected_value ?? field.normalized_value;
        // eslint-disable-next-line no-await-in-loop
        await patchField(field.id, {
          corrected_value: correctedValue,
          confirmed: true
        });
      }
      if (activeBatchId) {
        await loadDetail(activeBatchId);
        await loadBatches(activeBatchId);
      }
      setActionMessage(`已确认 ${target.length} 个低置信字段。`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '一键确认失败');
    } finally {
      setQuickConfirming(false);
    }
  };

  const commitBatch = async () => {
    if (!activeBatchId) return;
    clearActionHint();
    setBusyCommit(true);
    try {
      const res = await fetch(`/api/admin/archives/preview/${activeBatchId}/commit`, {
        method: 'POST',
        headers: authOnly
      });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));
      await loadBatches(activeBatchId);
      await loadDetail(activeBatchId);
      setActionMessage('已提交入库。');
      onCommitted?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '提交入库失败');
    } finally {
      setBusyCommit(false);
    }
  };

  const rejectBatch = async () => {
    if (!activeBatchId) return;
    const confirmed = window.confirm('确定驳回当前确认批次吗？驳回后可重新创建。');
    if (!confirmed) return;
    clearActionHint();
    setBusyReject(true);
    try {
      const res = await fetch(`/api/admin/archives/preview/${activeBatchId}`, {
        method: 'DELETE',
        headers: authOnly
      });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));
      await loadBatches();
      setActionMessage('批次已驳回。');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '驳回失败');
    } finally {
      setBusyReject(false);
    }
  };

  const deleteBatch = async () => {
    if (!activeBatchId) return;
    const isCommittedBatch = detail?.batch.status === 'COMMITTED';
    const confirmed = window.confirm(
      isCommittedBatch
        ? '确定要彻底删除当前批次吗？\n警告：该批次已入库，将同时删除库里由此批次写入的数据！此操作不可恢复！'
        : '确定要彻底删除当前批次吗？此操作不可恢复！'
    );
    if (!confirmed) return;
    clearActionHint();
    setBusyDelete(true);
    try {
      const res = await fetch(`/api/admin/archives/preview/${activeBatchId}/permanent`, {
        method: 'DELETE',
        headers: authOnly
      });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));
      const data: { deleted_history_actuals?: number } = await res.json();
      setActiveBatchId(null);
      setDetail(null);
      await loadBatches();
      if (isCommittedBatch) {
        setActionMessage(`批次已彻底删除，已删除关联入库数据 ${Number(data.deleted_history_actuals || 0)} 条。`);
      } else {
        setActionMessage('批次已彻底删除。');
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusyDelete(false);
    }
  };


  const deleteReport = async (reportId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm('确定要删除这个文件及其所有相关数据吗？\n警告：将同时删除相关的确认批次和草稿！此操作不可恢复！')) return;
    if (!reportId) {
      setActionError('删除文件失败：reportId 缺失');
      return;
    }

    clearActionHint();
    try {
      const encoded = encodeURIComponent(reportId);
      const candidates = [
        `/api/admin/archives/reports/${encoded}`,
        `/api/admin/archives/report/${encoded}`,
        `/api/admin/archives/preview/reports/${encoded}`
      ];
      let deleted = false;
      let lastMessage = '删除文件失败';

      for (const endpoint of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(endpoint, { method: 'DELETE', headers: authOnly });
        if (res.ok) {
          deleted = true;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        const message = prettifyError(await readError(res));
        lastMessage = message || lastMessage;
        if (!(res.status === 404 && /Route not found/i.test(message))) {
          throw new Error(message);
        }
      }
      if (!deleted) {
        throw new Error(lastMessage);
      }

      setActionMessage('文件已删除。');
      // Remove from selection if selected
      if (selectedReportIds.includes(reportId)) {
        setSelectedReportIds(prev => prev.filter(id => id !== reportId));
      }
      // Notify parent to refresh list
      onReportDeleted?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除文件失败');
    }
  };


  const updateAliasStatus = async (aliasId: string, status: AliasStatus) => {
    clearActionHint();
    setUpdatingAliasId(aliasId);
    try {
      const res = await fetch(`/api/admin/archives/alias-mappings/${aliasId}`, {
        method: 'PATCH',
        headers: authJson,
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error(prettifyError(await readError(res)));
      await loadAliases();
      setActionMessage('别名状态已更新。');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '更新别名失败');
    } finally {
      setUpdatingAliasId(null);
    }
  };

  const canEditCurrentBatch = Boolean(
    detail && detail.batch.status !== 'COMMITTED' && detail.batch.status !== 'REJECTED'
  );
  const canDeleteCurrentBatch = Boolean(detail);
  const pendingLowConfidenceCount = detail
    ? detail.fields.filter((field) => LOW_CONFIDENCE_SET.has(field.confidence) && !drafts[field.id]?.confirmed).length
    : 0;
  const changedCount = detail ? detail.fields.filter((field) => isFieldChanged(field.id)).length : 0;
  const issueErrorCount = detail ? detail.issues.filter((item) => item.level === 'ERROR').length : 0;
  const visibleIssues = detail ? (expandIssues ? detail.issues : detail.issues.slice(0, ISSUE_LIMIT)) : [];
  const visibleFields = detail
    ? detail.fields.filter((field) => !showOnlyNeedReview || isFieldChanged(field.id) || !drafts[field.id]?.confirmed)
    : [];

  return (
    <section className="border border-slate-200 rounded-xl bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">解析确认与入库</h3>
          <p className="text-sm text-slate-500 mt-1">先确认后入库，降低误识别对历史数据和大屏展示的影响。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadBatches(activeBatchId);
            if (activeBatchId) void loadDetail(activeBatchId);
            void loadAliases();
          }}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
          刷新
        </button>
      </div>

      {actionMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4">
        <aside className="border border-slate-200 rounded-xl p-3 bg-slate-50/40 space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-800">1) 选择文件并创建确认批次</div>
            <div className="max-h-52 overflow-auto rounded-lg border border-slate-200 bg-white">
              {reports.length === 0 ? (
                <div className="px-3 py-4 text-xs text-slate-500">暂无可选文件，请先上传 PDF。</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {reports.map((report) => (
                    <li key={report.id} className="px-3 py-2 text-sm">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedReportIds.includes(report.id)}
                          onChange={() => toggleReport(report.id)}
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-700 truncate" title={report.file_name}>
                            {report.file_name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {reportTypeLabel(report.report_type)}
                            {report.created_at ? ` · ${fmtTime(report.created_at)}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => void deleteReport(report.id, e)}
                          className="ml-auto p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                          title="删除文件"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={createBulk}
              disabled={creatingBulk || selectedReportIds.length === 0}
              className="w-full px-3 py-2 text-sm rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creatingBulk ? '创建中...' : `创建确认批次（已选 ${selectedReportIds.length} 个）`}
            </button>
          </div>

          <div className="border-t border-slate-200 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">2) 选择确认批次</div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
              >
                <option value="">全部状态</option>
                <option value="PENDING_REVIEW">待确认</option>
                <option value="REVIEWED">已复核</option>
                <option value="COMMITTED">已入库</option>
                <option value="REJECTED">已驳回</option>
              </select>
            </div>

            {loadingBatches ? <div className="text-xs text-slate-500">加载批次中...</div> : null}
            {batchError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-2.5 py-2 text-xs">{batchError}</div>
            ) : null}
            {!loadingBatches && !batchError && batches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">
                当前年度暂无确认批次。
              </div>
            ) : null}

            <div className="space-y-2 max-h-72 overflow-auto pr-1">
              {batches.map((batch) => {
                const active = batch.id === activeBatchId;
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => {
                      clearActionHint();
                      setActiveBatchId(batch.id);
                    }}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${active
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate" title={batch.file_name}>
                          {batch.file_name}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {reportTypeLabel(batch.report_type)} · {fmtTime(batch.created_at)}
                        </div>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_STYLE[batch.status]}`}>
                        {STATUS_LABEL[batch.status]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      字段 {batch.field_count ?? 0} · 问题 {batch.issue_count ?? 0}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-4">
          {!activeBatchId ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 text-center">
              请先在左侧选择一个确认批次。
            </div>
          ) : null}

          {loadingDetail ? <div className="text-sm text-slate-500">加载批次详情中...</div> : null}
          {detailError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">{detailError}</div>
          ) : null}

          {detail && !loadingDetail && !detailError ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800 truncate" title={detail.batch.file_name}>
                    {detail.batch.file_name}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    批次号：{detail.batch.id} · 创建时间：{fmtTime(detail.batch.created_at)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded border ${STATUS_STYLE[detail.batch.status]}`}>
                    {STATUS_LABEL[detail.batch.status]}
                  </span>
                  <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600">
                    字段 {detail.fields.length}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${issueErrorCount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                    问题 {detail.issues.length}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${pendingLowConfidenceCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    待确认 {pendingLowConfidenceCount}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-slate-50/50">
                <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={showOnlyNeedReview}
                    onChange={(event) => setShowOnlyNeedReview(event.target.checked)}
                  />
                  仅显示待确认/有改动
                </label>
                <button
                  type="button"
                  onClick={quickConfirmLowConfidence}
                  disabled={!canEditCurrentBatch || quickConfirming}
                  className="px-2.5 py-1.5 text-xs border border-amber-300 rounded text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                >
                  {quickConfirming ? '处理中...' : '一键确认低置信'}
                </button>
                <button
                  type="button"
                  onClick={saveAllChangedFields}
                  disabled={!canEditCurrentBatch || batchSaving || changedCount === 0}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {batchSaving ? '保存中...' : `保存全部改动（${changedCount}）`}
                </button>
                <button
                  type="button"
                  onClick={rejectBatch}
                  disabled={!canEditCurrentBatch || busyReject}
                  className="px-2.5 py-1.5 text-xs border border-rose-300 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  {busyReject ? '驳回中...' : '驳回批次'}
                </button>
                <button
                  type="button"
                  onClick={deleteBatch}
                  disabled={!canDeleteCurrentBatch || busyDelete}
                  className="px-2.5 py-1.5 text-xs border border-slate-400 rounded text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {busyDelete ? '删除中...' : '删除批次'}
                </button>
                <button
                  type="button"
                  onClick={commitBatch}
                  disabled={!canEditCurrentBatch || busyCommit}
                  className="px-2.5 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busyCommit ? '提交中...' : '提交入库'}
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg bg-white p-3">
                <div className="text-sm font-medium text-slate-800">OCR 执行状态</div>
                {detail.ocr_summary ? (
                  <div className="mt-2 text-xs text-slate-700 space-y-1">
                    <div>
                      状态：
                      {detail.ocr_summary.executed ? '已执行' : '未执行'}
                      {' / '}
                      {formatOcrReason(detail.ocr_summary.reason)}
                    </div>
                    <div>可疑表：{(detail.ocr_summary.suspicious_table_keys || []).join(', ') || '-'}</div>
                    <div>已处理表：{(detail.ocr_summary.processed_tables || []).join(', ') || '-'}</div>
                    <div>跳过表：{(detail.ocr_summary.skipped_tables || []).map((item) => formatSkippedTable(item)).join('；') || '-'}</div>
                    <div>OCR匹配字段数：{Number(detail.ocr_summary.matched_count || 0)}</div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500">当前批次无 OCR 记录（旧批次或未创建时采集）。</div>
                )}
              </div>

              <div className="border border-amber-200 rounded-lg bg-amber-50/60">
                <button
                  type="button"
                  onClick={() => setExpandIssues((prev) => !prev)}
                  className="w-full px-3 py-2 flex items-center justify-between text-left"
                >
                  <span className="text-sm font-medium text-amber-800">规则问题（{detail.issues.length}）</span>
                  <span className="text-amber-700">
                    {expandIssues ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </button>
                {detail.issues.length > 0 ? (
                  <div className="px-3 pb-3 space-y-1">
                    {visibleIssues.map((issue) => {
                      const evidenceLines = buildEvidenceLines(issue);
                      return (
                        <div key={issue.id} className={`text-xs rounded border bg-white text-slate-700 ${issue.level === 'ERROR' ? 'border-rose-200' : 'border-amber-200'
                          }`}>
                          <div className="px-2.5 py-1.5 flex items-start gap-1.5">
                            <span
                              className={`inline-block shrink-0 mt-0.5 px-1.5 py-0.5 rounded ${issue.level === 'ERROR' ? 'bg-rose-50 text-rose-700 font-medium' : 'bg-amber-50 text-amber-700'
                                }`}
                            >
                              {issue.level === 'ERROR' ? '错误' : '警告'}
                            </span>
                            <span>{formatIssueMessage(issue)}</span>
                          </div>
                          {evidenceLines.length > 0 && (
                            <div className={`mx-2.5 mb-2 px-2.5 py-2 rounded text-[11px] leading-relaxed space-y-0.5 font-mono ${issue.level === 'ERROR' ? 'bg-rose-50/60 text-rose-800' : 'bg-amber-50/60 text-amber-800'
                              }`}>
                              {evidenceLines.map((line, idx) => (
                                <div key={idx} className={line.startsWith('💡') ? 'font-sans font-medium mt-1 text-blue-700' : ''}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!expandIssues && detail.issues.length > ISSUE_LIMIT ? (
                      <div className="text-xs text-amber-700">
                        仅显示前 {ISSUE_LIMIT} 条，点击标题可展开全部。
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="px-3 pb-3 text-xs text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    当前无规则问题。
                  </div>
                )}
              </div>

              {/* 视图模式切换 */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <button
                  type="button"
                  onClick={() => setViewMode('fields')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${viewMode === 'fields'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                  <List className="w-3.5 h-3.5" />
                  字段列表
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('tables')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${viewMode === 'tables'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  原始表格 {detail.tables && detail.tables.length > 0 ? `(${detail.tables.length})` : ''}
                </button>
              </div>

              {/* 字段列表视图 */}
              {viewMode === 'fields' && (
                <div className="overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-[920px] w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-slate-700">
                        <th className="px-3 py-2 text-left">字段</th>
                        <th className="px-3 py-2 text-right">解析值</th>
                        <th className="px-3 py-2 text-right">修正值</th>
                        <th className="px-3 py-2 text-center">置信度</th>
                        <th className="px-3 py-2 text-center">确认</th>
                        <th className="px-3 py-2 text-left">来源片段</th>
                        <th className="px-3 py-2 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFields.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                            当前筛选条件下没有字段。
                          </td>
                        </tr>
                      ) : (
                        visibleFields.map((field) => {
                          const draft = drafts[field.id] || { corrected: '', confirmed: Boolean(field.confirmed) };
                          const changed = isFieldChanged(field.id);
                          const lowConfidenceUnconfirmed = LOW_CONFIDENCE_SET.has(field.confidence) && !draft.confirmed;
                          return (
                            <tr
                              key={field.id}
                              className={`border-t ${lowConfidenceUnconfirmed
                                ? 'bg-amber-50/40'
                                : changed
                                  ? 'bg-sky-50/30'
                                  : 'bg-white'
                                }`}
                            >
                              <td className="px-3 py-2 align-top">
                                <div className="text-xs text-slate-800">{FIELD_LABEL[field.key] || field.key}</div>
                                <div className="font-mono text-[11px] text-slate-500 mt-0.5">{field.key}</div>
                              </td>
                              <td className="px-3 py-2 text-right align-top">{toInput(field.normalized_value) || '-'}</td>
                              <td className="px-3 py-2 text-right align-top">
                                <input
                                  type="number"
                                  value={draft.corrected}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [field.id]: {
                                        corrected: next,
                                        confirmed: prev[field.id]?.confirmed ?? Boolean(field.confirmed)
                                      }
                                    }));
                                  }}
                                  disabled={!canEditCurrentBatch}
                                  className="w-28 text-right px-2 py-1 border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-400"
                                />
                              </td>
                              <td className="px-3 py-2 text-center align-top">
                                <span className={`inline-flex px-2 py-0.5 text-xs rounded border ${CONFIDENCE_STYLE[field.confidence]}`}>
                                  {CONFIDENCE_LABEL[field.confidence]}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center align-top">
                                <input
                                  type="checkbox"
                                  checked={draft.confirmed}
                                  disabled={!canEditCurrentBatch}
                                  onChange={(event) => {
                                    const next = event.target.checked;
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [field.id]: {
                                        corrected: prev[field.id]?.corrected ?? toInput(field.corrected_value ?? field.normalized_value),
                                        confirmed: next
                                      }
                                    }));
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-600 align-top">
                                <div className="max-w-[320px] truncate" title={field.raw_text_snippet || ''}>
                                  {field.raw_text_snippet || '-'}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-center align-top">
                                <button
                                  type="button"
                                  onClick={() => void saveField(field.id)}
                                  disabled={!canEditCurrentBatch || !changed || savingFieldId === field.id}
                                  className="px-2.5 py-1 text-xs border border-slate-300 rounded text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  {savingFieldId === field.id ? '保存中...' : '保存'}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 原始表格视图 */}
              {viewMode === 'tables' && (
                <div className="h-[600px] border border-slate-200 rounded-lg overflow-hidden">
                  <TableDataViewer tables={detail.tables || []} />
                </div>
              )}

              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-800">别名审核</div>
                  <div className="flex items-center gap-2">
                    <select
                      value={aliasStatus}
                      onChange={(event) => setAliasStatus(event.target.value as AliasStatus)}
                      className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
                    >
                      <option value="CANDIDATE">待审核</option>
                      <option value="APPROVED">已通过</option>
                      <option value="REJECTED">已驳回</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void loadAliases()}
                      className="text-xs border border-slate-300 rounded px-2 py-1 bg-white hover:bg-slate-50"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                {loadingAliases ? <div className="text-xs text-slate-500">加载中...</div> : null}
                {aliasError ? <div className="text-xs text-rose-700">{aliasError}</div> : null}

                <div className="overflow-auto rounded border border-slate-200 bg-white">
                  <table className="min-w-[720px] w-full text-xs">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="px-2 py-2 text-left">原始标签</th>
                        <th className="px-2 py-2 text-left">归一化</th>
                        <th className="px-2 py-2 text-left">匹配字段</th>
                        <th className="px-2 py-2 text-left">状态</th>
                        <th className="px-2 py-2 text-left">更新时间</th>
                        <th className="px-2 py-2 text-left">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aliases.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                            当前筛选下没有别名记录。
                          </td>
                        </tr>
                      ) : (
                        aliases.map((alias) => (
                          <tr key={alias.id} className="border-t">
                            <td className="px-2 py-2">{alias.raw_label}</td>
                            <td className="px-2 py-2 font-mono text-[11px] text-slate-600">{alias.normalized_label}</td>
                            <td className="px-2 py-2 font-mono text-[11px] text-slate-700">{alias.resolved_key}</td>
                            <td className="px-2 py-2">{ALIAS_STATUS_LABEL[alias.status]}</td>
                            <td className="px-2 py-2">{fmtTime(alias.updated_at)}</td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void updateAliasStatus(alias.id, 'APPROVED')}
                                  disabled={updatingAliasId === alias.id || alias.status === 'APPROVED'}
                                  className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  通过
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void updateAliasStatus(alias.id, 'REJECTED')}
                                  disabled={updatingAliasId === alias.id || alias.status === 'REJECTED'}
                                  className="px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                >
                                  驳回
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void updateAliasStatus(alias.id, 'CANDIDATE')}
                                  disabled={updatingAliasId === alias.id || alias.status === 'CANDIDATE'}
                                  className="px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  退回待审
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default ArchivePreviewPanel;
