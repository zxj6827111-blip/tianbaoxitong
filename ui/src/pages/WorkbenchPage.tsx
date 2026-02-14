import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FileUpload } from '../components/workbench/FileUpload';
import { InputFieldKey, ManualInputsForm, ManualFormSection } from '../components/workbench/ManualInputsForm';
import { BudgetExplanationComposer } from '../components/workbench/BudgetExplanationComposer';
import { BudgetTablesViewer } from '../components/workbench/BudgetTablesViewer';
import { OtherRelatedComposer } from '../components/workbench/OtherRelatedComposer';
import { ValidationPanel } from '../components/workbench/ValidationPanel';
import { apiClient } from '../utils/apiClient';
import { useToast } from '../hooks/use-toast';
import { ToastContainer } from '../components/ui/Toast';
import {
  AlertTriangle,
  CheckCircle,
  Circle,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  LogOut,
  PlayCircle,
  Settings,
  User
} from 'lucide-react';

interface ManualInput {
  id?: number;
  key: string;
  value_text?: string | null;
  value_numeric?: number | null;
}

interface ValidationIssue {
  id: number;
  level: 'FATAL' | 'WARNING' | 'SUGGEST';
  rule_id: string;
  message: string;
  evidence?: {
    anchor?: string;
    item_key?: string;
    missing_keys?: Array<{ key: string }>;
    [key: string]: any;
  };
}

interface DraftMeta {
  id: string;
  unit_id: string;
  year: number;
  status: 'DRAFT' | 'VALIDATED' | 'SUBMITTED' | 'GENERATED' | string;
  updated_at?: string | null;
  created_at?: string | null;
}

interface RecentDraft {
  id: string;
  unit_id: string;
  unit_name?: string | null;
  year: number;
  status: string;
  caliber?: string;
  file_name?: string | null;
  updated_at?: string | null;
}

type WorkflowStage = 'entry' | 'upload' | 'directory';
type UploadMode = 'normal' | 'copy_previous';

type DirectoryStepKey =
  | 'section_main_functions'
  | 'section_organization'
  | 'section_glossary'
  | 'section_budget_explanation'
  | 'section_budget_tables'
  | 'section_other_related'
  | 'section_project_expense'
  | 'preview_review'
  | 'download_export';

interface DirectoryStepItem {
  key: DirectoryStepKey;
  label: string;
  description: string;
  type: 'manual' | 'line_items' | 'review' | 'download';
  section?: ManualFormSection;
}

interface MissingFieldItem {
  id: string;
  label: string;
  step: DirectoryStepKey;
  fieldKey?: InputFieldKey;
  detail?: string;
}

interface ReceiptTimelineItem {
  action: string;
  label: string;
  at: string;
  meta?: any;
}

interface DraftReceipt {
  receipt_no: string;
  draft: DraftMeta;
  latest_report_version?: {
    id: number;
    version_no: number;
    generated_at: string;
  } | null;
  timeline: ReceiptTimelineItem[];
}

interface DiffItem {
  key: string;
  label: string;
  current_value: number | null;
  previous_value: number | null;
  diff_value: number | null;
  diff_ratio: number | null;
}

const DIRECTORY_STEPS: DirectoryStepItem[] = [
  {
    key: 'section_main_functions',
    label: '一、部门主要职能',
    description: '填写部门职责范围、履职定位和重点工作。',
    type: 'manual',
    section: 'main_functions'
  },
  {
    key: 'section_organization',
    label: '二、部门机构设置',
    description: '填写内设机构、职责分工和编制情况。',
    type: 'manual',
    section: 'organizational_structure'
  },
  {
    key: 'section_glossary',
    label: '三、名词解释',
    description: '补充公开稿中需要解释的业务名词。',
    type: 'manual',
    section: 'glossary'
  },
  {
    key: 'section_budget_explanation',
    label: '四、部门预算编制说明',
    description: '填写预算编制依据、口径和增减原因。',
    type: 'manual',
    section: 'budget_explanation'
  },
  {
    key: 'section_budget_tables',
    label: '五、部门预算表',
    description: '核对系统抽取的9张预算表内容，确认表格完整性。',
    type: 'line_items'
  },
  {
    key: 'section_other_related',
    label: '六、其他相关情况说明',
    description: '补充采购、资产等其他说明性内容。',
    type: 'manual',
    section: 'other_related'
  },
  {
    key: 'section_project_expense',
    label: '七、项目经费情况说明',
    description: '填写项目绩效目标和完成情况。',
    type: 'manual',
    section: 'project_expense'
  },
  {
    key: 'preview_review',
    label: '八、预览与校验',
    description: '统一校验并在网页内预览PDF排版效果。',
    type: 'review'
  },
  {
    key: 'download_export',
    label: '九、下载报告',
    description: '确认预览无误后下载PDF与Excel。',
    type: 'download'
  }
];

const LAST_DRAFT_KEY = 'last_draft_id';
const isUsableDraftId = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0 && value !== 'NaN';
};

const FIELD_TO_STEP: Partial<Record<InputFieldKey, DirectoryStepKey>> = {
  main_functions: 'section_main_functions',
  organizational_structure: 'section_organization',
  glossary: 'section_glossary',
  budget_explanation: 'section_budget_explanation',
  budget_change_reason: 'section_budget_explanation',
  state_owned_assets: 'section_other_related',
  procurement_amount: 'section_other_related',
  procurement_notes: 'section_other_related',
  asset_total: 'section_other_related',
  asset_notes: 'section_other_related',
  project_overview: 'section_project_expense',
  project_basis: 'section_project_expense',
  project_subject: 'section_project_expense',
  project_plan: 'section_project_expense',
  project_cycle: 'section_project_expense',
  project_budget_arrangement: 'section_project_expense',
  project_performance_goal: 'section_project_expense',
  performance_target: 'section_project_expense',
  performance_result: 'section_project_expense'
};

const PROJECT_EXPENSE_REQUIRED_FIELDS: Array<{ key: InputFieldKey; label: string }> = [
  { key: 'project_overview', label: '项目概述' },
  { key: 'project_basis', label: '立项依据' },
  { key: 'project_subject', label: '实施主体' },
  { key: 'project_plan', label: '实施方案' },
  { key: 'project_cycle', label: '实施周期' },
  { key: 'project_budget_arrangement', label: '年度预算安排' },
  { key: 'project_performance_goal', label: '绩效目标' }
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const formatAmount = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const textFilled = (inputsByKey: Map<string, ManualInput>, key: string) => {
  const value = inputsByKey.get(key)?.value_text;
  return typeof value === 'string' && value.trim().length > 0;
};

const numericFilled = (inputsByKey: Map<string, ManualInput>, key: string) => {
  const value = inputsByKey.get(key)?.value_numeric;
  return value !== null && value !== undefined;
};

export const WorkbenchPage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [stage, setStage] = useState<WorkflowStage>('entry');
  const [uploadMode, setUploadMode] = useState<UploadMode>('normal');
  const [currentStep, setCurrentStep] = useState<DirectoryStepKey>('section_main_functions');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [manualInputs, setManualInputs] = useState<ManualInput[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<RecentDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [loadingDraftContext, setLoadingDraftContext] = useState(false);
  const [loadingReviewData, setLoadingReviewData] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoadingPreviewFile, setIsLoadingPreviewFile] = useState(false);
  const [lineItemStats, setLineItemStats] = useState({ total: 0, required: 0, missing: 0 });
  const [budgetTableStats, setBudgetTableStats] = useState({ loaded: false, total: 0, ready: 0, missing: 0 });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{ page_count: number; blank_pages: number[] } | null>(null);
  const [previewErrorText, setPreviewErrorText] = useState<string | null>(null);
  const [downloadedFlags, setDownloadedFlags] = useState({ pdf: false, excel: false });
  const [receipt, setReceipt] = useState<DraftReceipt | null>(null);
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [liveCompletion, setLiveCompletion] = useState<Partial<Record<ManualFormSection, boolean>>>({});
  const [focusRequest, setFocusRequest] = useState<{ key: InputFieldKey; nonce: number } | null>(null);

  const isAdminView = user?.role === 'admin' || user?.role === 'maintainer';

  const inputsByKey = useMemo(() => {
    const map = new Map<string, ManualInput>();
    manualInputs.forEach((item) => map.set(item.key, item));
    return map;
  }, [manualInputs]);

  const derivedManualCompletion = useMemo(() => {
    const projectExpenseCompleted = PROJECT_EXPENSE_REQUIRED_FIELDS
      .every((field) => textFilled(inputsByKey, field.key));

    return {
      main_functions: textFilled(inputsByKey, 'main_functions'),
      organizational_structure: textFilled(inputsByKey, 'organizational_structure'),
      glossary: textFilled(inputsByKey, 'glossary'),
      budget_explanation: textFilled(inputsByKey, 'budget_change_reason'),
      other_related: textFilled(inputsByKey, 'state_owned_assets')
        || textFilled(inputsByKey, 'procurement_notes')
        || textFilled(inputsByKey, 'asset_notes')
        || numericFilled(inputsByKey, 'procurement_amount')
        || numericFilled(inputsByKey, 'asset_total'),
      project_expense: projectExpenseCompleted
    };
  }, [inputsByKey]);

  const manualCompletion = useMemo(() => ({
    main_functions: liveCompletion.main_functions ?? derivedManualCompletion.main_functions,
    organizational_structure: liveCompletion.organizational_structure ?? derivedManualCompletion.organizational_structure,
    glossary: liveCompletion.glossary ?? derivedManualCompletion.glossary,
    budget_explanation: liveCompletion.budget_explanation ?? derivedManualCompletion.budget_explanation,
    other_related: liveCompletion.other_related ?? derivedManualCompletion.other_related,
    project_expense: liveCompletion.project_expense ?? derivedManualCompletion.project_expense
  }), [liveCompletion, derivedManualCompletion]);

  const fatalCount = useMemo(() => issues.filter((issue) => issue.level === 'FATAL').length, [issues]);

  const missingFieldItems = useMemo<MissingFieldItem[]>(() => {
    const missing: MissingFieldItem[] = [];

    if (!textFilled(inputsByKey, 'main_functions')) {
      missing.push({
        id: 'main_functions',
        label: '部门主要职能',
        step: 'section_main_functions',
        fieldKey: 'main_functions'
      });
    }

    if (!textFilled(inputsByKey, 'organizational_structure')) {
      missing.push({
        id: 'organizational_structure',
        label: '部门机构设置',
        step: 'section_organization',
        fieldKey: 'organizational_structure'
      });
    }

    if (!textFilled(inputsByKey, 'glossary')) {
      missing.push({
        id: 'glossary',
        label: '名词解释',
        step: 'section_glossary',
        fieldKey: 'glossary'
      });
    }

    if (!textFilled(inputsByKey, 'budget_change_reason')) {
      missing.push({
        id: 'budget_change_reason',
        label: '预算增减主要原因',
        step: 'section_budget_explanation',
        fieldKey: 'budget_change_reason'
      });
    }

    if (!textFilled(inputsByKey, 'state_owned_assets')) {
      missing.push({
        id: 'state_owned_assets',
        label: '国有资产占有使用情况',
        step: 'section_other_related',
        fieldKey: 'state_owned_assets'
      });
    }

    PROJECT_EXPENSE_REQUIRED_FIELDS.forEach((field) => {
      if (!textFilled(inputsByKey, field.key)) {
        missing.push({
          id: field.key,
          label: field.label,
          step: 'section_project_expense',
          fieldKey: field.key
        });
      }
    });

    if (lineItemStats.missing > 0) {
      missing.push({
        id: 'line_items_missing',
        label: '预算表变动原因缺失',
        step: 'section_budget_explanation',
        detail: `仍有 ${lineItemStats.missing} 条未填写`
      });
    }

    return missing;
  }, [inputsByKey, lineItemStats.missing]);

  const stepCompletion = useMemo(() => {
    const base: Record<DirectoryStepKey, boolean> = {
      section_main_functions: manualCompletion.main_functions,
      section_organization: manualCompletion.organizational_structure,
      section_glossary: manualCompletion.glossary,
      section_budget_explanation: manualCompletion.budget_explanation && (lineItemStats.required === 0 ? true : lineItemStats.missing === 0),
      section_budget_tables: budgetTableStats.loaded && budgetTableStats.missing === 0,
      section_other_related: manualCompletion.other_related,
      section_project_expense: manualCompletion.project_expense,
      preview_review: previewReady,
      download_export: previewReady && downloadedFlags.pdf && downloadedFlags.excel
    };
    return base;
  }, [manualCompletion, lineItemStats, budgetTableStats.loaded, budgetTableStats.missing, previewReady, downloadedFlags.pdf, downloadedFlags.excel]);

  const completedDirectoryCount = useMemo(() => {
    return DIRECTORY_STEPS.slice(0, 7).filter((step) => stepCompletion[step.key]).length;
  }, [stepCompletion]);

  const directoryProgress = Math.round((completedDirectoryCount / 7) * 100);

  const currentStepConfig = DIRECTORY_STEPS.find((item) => item.key === currentStep) || DIRECTORY_STEPS[0];
  const currentStepIndex = DIRECTORY_STEPS.findIndex((item) => item.key === currentStep);
  const canGeneratePreview = missingFieldItems.length === 0 && fatalCount === 0;

  const loadRecentDrafts = useCallback(async () => {
    try {
      setLoadingDrafts(true);
      const response = await apiClient.listDrafts({ limit: 8 });
      setRecentDrafts(response.drafts || []);
    } catch (error) {
      console.error('Failed to load recent drafts:', error);
      toast.error('加载草稿列表失败');
    } finally {
      setLoadingDrafts(false);
    }
  }, [toast.error]);

  const loadReviewData = useCallback(async (targetDraftId: string) => {
    try {
      setLoadingReviewData(true);
      const [receiptResp, diffResp] = await Promise.all([
        apiClient.getDraftReceipt(targetDraftId),
        apiClient.getDraftDiffSummary(targetDraftId)
      ]);

      const nextReceipt = receiptResp?.receipt || null;
      setReceipt(nextReceipt);
      if (nextReceipt?.draft) {
        setDraftMeta(nextReceipt.draft);
      }

      setDiffItems(diffResp?.items || []);
    } catch (error) {
      console.error('Failed to load review data:', error);
    } finally {
      setLoadingReviewData(false);
    }
  }, []);

  const loadDraftContext = useCallback(async (targetDraftId: string) => {
    if (!isUsableDraftId(targetDraftId)) {
      toast.error('草稿ID无效，请从“最近草稿”重新进入');
      return;
    }

    try {
      setLoadingDraftContext(true);
      const response = await apiClient.getDraft(targetDraftId);
      const meta: DraftMeta = response.draft;

      setDraftId(String(meta.id));
      setDraftMeta(meta);
      setManualInputs(response.manual_inputs || []);
      setIssues([]);
      setLineItemStats({ total: 0, required: 0, missing: 0 });
      setBudgetTableStats({ loaded: false, total: 0, ready: 0, missing: 0 });
      setLiveCompletion({});
      setFocusRequest(null);
      setReceipt(null);
      setDiffItems([]);
      setPreviewReady(false);
      setPreviewInfo(null);
      setPreviewErrorText(null);
      setDownloadedFlags({ pdf: false, excel: false });
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
      setPreviewBlobUrl(null);
      setStage('directory');
      setCurrentStep('section_main_functions');
      localStorage.setItem(LAST_DRAFT_KEY, String(targetDraftId));
      toast.success(`已进入草稿 #${targetDraftId}`);
    } catch (error: any) {
      console.error('Failed to load draft:', error);
      const message = error?.response?.data?.message || '加载草稿失败';
      toast.error(message);
    } finally {
      setLoadingDraftContext(false);
    }
  }, [previewBlobUrl, toast.error, toast.success]);

  useEffect(() => {
    if (stage === 'entry') {
      void loadRecentDrafts();
    }
  }, [stage, loadRecentDrafts]);

  useEffect(() => {
    if (stage !== 'entry' || recentDrafts.length === 0) {
      return;
    }

    const lastDraftId = localStorage.getItem(LAST_DRAFT_KEY);
    if (!isUsableDraftId(lastDraftId)) {
      return;
    }

    const exists = recentDrafts.some((item) => String(item.id) === lastDraftId);
    if (!exists) {
      localStorage.removeItem(LAST_DRAFT_KEY);
    }
  }, [stage, recentDrafts]);

  useEffect(() => {
    if (stage === 'directory' && (currentStep === 'preview_review' || currentStep === 'download_export') && draftId) {
      void loadReviewData(draftId);
    }
  }, [stage, currentStep, draftId, loadReviewData]);

  useEffect(() => {
    if (stage !== 'directory' || !draftId) {
      return;
    }

    let mounted = true;
    const loadBudgetTableStatus = async () => {
      try {
        const response = await apiClient.listBudgetTables(draftId);
        if (!mounted) {
          return;
        }
        const tables = Array.isArray(response?.tables) ? response.tables : [];
        const ready = tables.filter((item: { status?: string }) => item.status === 'READY').length;
        const missing = tables.filter((item: { status?: string }) => item.status !== 'READY').length;
        setBudgetTableStats({ loaded: true, total: tables.length, ready, missing });
      } catch (error) {
        if (!mounted) {
          return;
        }
        setBudgetTableStats({ loaded: false, total: 0, ready: 0, missing: 0 });
      }
    };

    void loadBudgetTableStatus();
    return () => {
      mounted = false;
    };
  }, [stage, draftId]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  const handleStartNew = (mode: UploadMode = 'normal') => {
    setUploadMode(mode);
    setStage('upload');
    setDraftId(null);
    setDraftMeta(null);
    setManualInputs([]);
    setIssues([]);
    setLineItemStats({ total: 0, required: 0, missing: 0 });
    setBudgetTableStats({ loaded: false, total: 0, ready: 0, missing: 0 });
    setLiveCompletion({});
    setFocusRequest(null);
    setReceipt(null);
    setDiffItems([]);
    setPreviewReady(false);
    setPreviewInfo(null);
    setPreviewErrorText(null);
    setDownloadedFlags({ pdf: false, excel: false });
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
    }
    setPreviewBlobUrl(null);
  };

  const handleUploadComplete = async (newDraftId: string) => {
    try {
      if (uploadMode === 'copy_previous') {
        const sourceResp = await apiClient.listCopySources(newDraftId);
        const sources = sourceResp?.sources || [];

        if (sources.length > 0) {
          const source = sources[0];
          const response = await apiClient.copyPreviousDraftFromSource(newDraftId, {
            source_draft_id: source.id
          });
          const copiedManualCount = Number(response?.copied_manual_inputs || 0);
          const copiedLineItemsCount = Number(response?.copied_line_items || 0);
          if (sources.length > 1) {
            toast.info(`发现 ${sources.length} 份上期草稿，已按最近更新自动复制。`);
          }
          if (copiedManualCount > 0 || copiedLineItemsCount > 0) {
            toast.success(`已复制上期草稿内容（补录 ${copiedManualCount} 项，预算表原因 ${copiedLineItemsCount} 项）`);
          } else {
            toast.info('已创建草稿，但上期无可复制内容');
          }
        } else {
          toast.info('未找到上期草稿，已进入当前草稿继续填报');
        }
      } else {
        toast.success('文件上传并解析成功');
      }
    } catch (error: any) {
      const errorCode = error?.response?.data?.code;
      if (errorCode === 'PREVIOUS_DRAFT_NOT_FOUND') {
        toast.info('未找到上期草稿，已进入当前草稿继续填报');
      } else {
        toast.error('复制上期内容失败，已进入当前草稿');
      }
    } finally {
      setUploadMode('normal');
      await loadDraftContext(newDraftId);
    }
  };

  const handleUploadError = (error: string) => {
    toast.error(error);
  };

  const handleManualInputsSave = useCallback(async (inputs: ManualInput[]) => {
    if (!draftId) return;

    try {
      const response = await apiClient.updateManualInputs(draftId, {
        inputs,
        if_match_updated_at: draftMeta?.updated_at || undefined
      });
      setManualInputs(response.manual_inputs || []);
      if (response?.draft) {
        setDraftMeta(response.draft);
      }
    } catch (error) {
      toast.error('保存失败，请重试');
      throw error;
    }
  }, [draftId, draftMeta?.updated_at, toast.error]);

  const handleReuseHistory = useCallback(async (key: string) => {
    if (!draftId) return null;
    try {
      const response = await apiClient.getHistoryText(draftId, key);
      if (!response?.content_text) {
        toast.info('未找到可复用的历史内容');
        return null;
      }
      return response.content_text;
    } catch (error) {
      toast.error('引用历史内容失败');
      return null;
    }
  }, [draftId, toast.error, toast.info]);

  const loadPreviewBlob = useCallback(async (targetDraftId: string) => {
    setIsLoadingPreviewFile(true);
    try {
      const blob = await apiClient.getDraftPreviewPdfBlob(targetDraftId);
      setPreviewBlobUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(blob);
      });
      setPreviewReady(true);
      setPreviewErrorText(null);
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 404) {
        setPreviewReady(false);
        setPreviewBlobUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
          }
          return null;
        });
        return;
      }
      throw error;
    } finally {
      setIsLoadingPreviewFile(false);
    }
  }, []);

  const handleGeneratePreview = useCallback(async () => {
    if (!draftId) return;
    if (!canGeneratePreview) {
      toast.error('请先补齐缺失字段并修复 Fatal 错误后再生成预览。');
      return;
    }

    try {
      setIsPreviewing(true);
      setPreviewErrorText(null);
      const response = await apiClient.generateReportPreview(draftId, {
        if_match_updated_at: draftMeta?.updated_at || undefined
      });
      setPreviewInfo(response?.preflight || null);
      setDownloadedFlags({ pdf: false, excel: false });
      await loadPreviewBlob(draftId);
      toast.success('预览生成成功，请在页面中检查版式。');
    } catch (error: any) {
      const backendMessage = error?.response?.data?.message;
      const fallbackMessage = typeof error?.message === 'string' ? error.message : '';
      setPreviewErrorText(backendMessage || fallbackMessage || '生成预览失败，请重试');
      toast.error(backendMessage || '生成预览失败');
    } finally {
      setIsPreviewing(false);
    }
  }, [canGeneratePreview, draftId, draftMeta?.updated_at, loadPreviewBlob, toast.error, toast.success]);

  const handleDownloadPreviewPdf = useCallback(async () => {
    if (!draftId) return;
    try {
      await apiClient.downloadDraftPreviewPdf(draftId);
      setDownloadedFlags((prev) => ({ ...prev, pdf: true }));
    } catch (error) {
      toast.error('下载预览PDF失败，请重试');
    }
  }, [draftId, toast.error]);

  const handleDownloadPreviewExcel = useCallback(async () => {
    if (!draftId) return;
    try {
      await apiClient.downloadDraftPreviewExcel(draftId);
      setDownloadedFlags((prev) => ({ ...prev, excel: true }));
    } catch (error) {
      toast.error('下载预览Excel失败，请重试');
    }
  }, [draftId, toast.error]);

  useEffect(() => {
    if (stage !== 'directory' || !draftId) {
      return;
    }
    void loadPreviewBlob(draftId).catch(() => {
      toast.error('读取已有预览失败，请重新生成预览。');
    });
  }, [stage, draftId, loadPreviewBlob, toast.error]);

  const handleBudgetLineItemStatsChange = useCallback((stats: { total: number; required: number; missing: number }) => {
    setLineItemStats((prev) => {
      if (prev.total === stats.total && prev.required === stats.required && prev.missing === stats.missing) {
        return prev;
      }
      return stats;
    });
  }, []);

  const handleBudgetDraftUpdated = useCallback((nextDraft: DraftMeta | null | undefined) => {
    if (!nextDraft) {
      return;
    }
    setDraftMeta((prev) => {
      if (!prev) {
        return nextDraft;
      }
      if (prev.id === nextDraft.id && prev.status === nextDraft.status && prev.updated_at === nextDraft.updated_at) {
        return prev;
      }
      return nextDraft;
    });
  }, []);

  const handleBudgetCompletionChange = useCallback((completed: boolean) => {
    setLiveCompletion((prev) => {
      if (prev.budget_explanation === completed) {
        return prev;
      }
      return { ...prev, budget_explanation: completed };
    });
  }, []);

  const handleBudgetTableStatusChange = useCallback((status: { loaded: boolean; total: number; ready: number; missing: number }) => {
    setBudgetTableStats((prev) => {
      if (
        prev.loaded === status.loaded
        && prev.total === status.total
        && prev.ready === status.ready
        && prev.missing === status.missing
      ) {
        return prev;
      }
      return status;
    });
  }, []);

  const handleNextDirectoryStep = () => {
    if (currentStepIndex < DIRECTORY_STEPS.length - 1) {
      setCurrentStep(DIRECTORY_STEPS[currentStepIndex + 1].key);
    }
  };

  const handlePrevDirectoryStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStep(DIRECTORY_STEPS[currentStepIndex - 1].key);
    }
  };

  const jumpToField = (step: DirectoryStepKey, fieldKey?: InputFieldKey) => {
    setCurrentStep(step);
    if (fieldKey) {
      setFocusRequest({
        key: fieldKey,
        nonce: Date.now()
      });
    }
  };

  const resolveIssueNavigation = (issue: ValidationIssue): { step: DirectoryStepKey; fieldKey?: InputFieldKey } => {
    if (issue.rule_id === 'REASON_REQUIRED_MISSING') {
      return { step: 'section_budget_explanation' };
    }

    const evidence = issue.evidence || {};
    const missingKey = evidence?.missing_keys?.[0]?.key as InputFieldKey | undefined;
    if (missingKey && FIELD_TO_STEP[missingKey]) {
      return { step: FIELD_TO_STEP[missingKey] as DirectoryStepKey, fieldKey: missingKey };
    }

    const anchor = String(evidence.anchor || '');
    if (anchor.startsWith('manual_inputs:')) {
      const key = anchor.replace('manual_inputs:', '').split(',')[0] as InputFieldKey;
      if (FIELD_TO_STEP[key]) {
        return { step: FIELD_TO_STEP[key] as DirectoryStepKey, fieldKey: key };
      }
    }

    if (anchor.includes('line_items_reason')) {
      return { step: 'section_budget_explanation' };
    }

    return { step: 'preview_review' };
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const renderEntryStage = () => {
    const lastDraftId = localStorage.getItem(LAST_DRAFT_KEY);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
          <h2 className="text-xl font-bold text-slate-900">请选择填报任务</h2>
          <p className="text-sm text-slate-600">目录驱动流程：先按章节填报，再统一校验与提交。</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => handleStartNew('normal')}
              className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-4 text-left hover:bg-brand-100 transition-colors"
            >
              <div className="text-sm font-semibold text-brand-700">开始新填报</div>
              <div className="text-xs text-brand-600 mt-1">上传本年度 Excel 并创建新草稿</div>
            </button>

            <button
              type="button"
              disabled={loadingDraftContext || !isUsableDraftId(lastDraftId)}
              onClick={() => {
                if (isUsableDraftId(lastDraftId)) {
                  void loadDraftContext(lastDraftId);
                }
              }}
              className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-left hover:border-brand-200 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="text-sm font-semibold text-slate-700">继续上次草稿</div>
              <div className="text-xs text-slate-500 mt-1">从最近一次填报位置继续</div>
            </button>

            <button
              type="button"
              onClick={() => handleStartNew('copy_previous')}
              className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-left hover:border-brand-200 hover:bg-slate-50 transition-colors"
            >
              <div className="text-sm font-semibold text-slate-700">复制上期模式</div>
              <div className="text-xs text-slate-500 mt-1">上传后自动复制上年草稿的补录和预算表原因</div>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">流程说明</h3>
          <div className="text-sm text-slate-600 space-y-2">
            <p>1. 上传预算模板并自动解析。</p>
            <p>2. 按目录 1-7 逐步填报，系统自动保存。</p>
            <p>3. 第 8 步网页内预览排版，第 9 步直接下载 PDF 和 Excel。</p>
          </div>
        </div>

        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900">最近草稿</h3>
            <button
              type="button"
              onClick={() => void loadRecentDrafts()}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              刷新
            </button>
          </div>

          {loadingDrafts ? (
            <p className="text-sm text-slate-500">草稿加载中...</p>
          ) : recentDrafts.length === 0 ? (
            <p className="text-sm text-slate-500">暂无草稿，请先开始新填报。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {recentDrafts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadDraftContext(String(item.id))}
                  className="rounded-lg border border-slate-200 p-4 text-left hover:border-brand-300 hover:bg-slate-50 transition-colors"
                >
                  <p className="text-sm font-semibold text-slate-800">草稿 #{item.id}</p>
                  <p className="text-xs text-slate-500 mt-1">单位: {item.unit_name || item.unit_id}</p>
                  <p className="text-xs text-slate-500">年度: {item.year} | 口径: {item.caliber || '-'}</p>
                  <p className="text-xs text-slate-500">状态: {item.status}</p>
                  <p className="text-xs text-slate-400 mt-2">更新: {formatDateTime(item.updated_at)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderUploadStage = () => (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">上传预算 Excel 文件</h2>
          <button
            type="button"
            onClick={() => {
              setUploadMode('normal');
              setStage('entry');
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            返回任务首页
          </button>
        </div>
        {uploadMode === 'copy_previous' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            当前为“复制上期模式”：上传并解析完成后，系统会自动复制上一年度草稿中的补录字段和预算表原因说明。
          </div>
        )}
        <FileUpload onUploadComplete={handleUploadComplete} onError={handleUploadError} />
      </div>
    </div>
  );

  const renderPreviewReview = () => {
    const checklist = DIRECTORY_STEPS.slice(0, 7);

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-4">预览前总览</h3>
          <div className="space-y-3">
            {checklist.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  {stepCompletion[item.key] ? (
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  )}
                  <span className="text-sm text-slate-700">{item.label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => jumpToField(item.key)}
                  className="text-xs text-brand-600 hover:text-brand-700"
                >
                  去填写
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-4">缺失字段清单</h3>
          {missingFieldItems.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              必填字段已补齐，可以进入网页预览环节。
            </div>
          ) : (
            <div className="space-y-2">
              {missingFieldItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                >
                  <div className="text-sm text-amber-900">
                    <span>{item.label}</span>
                    {item.detail ? <span className="ml-2 text-xs text-amber-700">({item.detail})</span> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => jumpToField(item.step, item.fieldKey)}
                    className="text-xs text-brand-600 hover:text-brand-700"
                  >
                    去补齐
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <ValidationPanel
            draftId={draftId!}
            ifMatchUpdatedAt={draftMeta?.updated_at || undefined}
            onValidate={() => toast.info('校验完成')}
            onValidated={(result) => {
              if (result?.draft) {
                setDraftMeta(result.draft);
              }
            }}
            onIssuesChange={(nextIssues) => setIssues(nextIssues)}
            onIssueClick={(issue) => {
              const target = resolveIssueNavigation(issue);
              jumpToField(target.step, target.fieldKey);
            }}
          />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">网页内预览</h3>
            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">当前状态: {draftMeta?.status || '-'}</span>
          </div>
          <p className="text-sm text-slate-600">
            先在网页内检查段落、表格行高与备注显示，确认无误后再到第9步下载。
          </p>

          <button
            type="button"
            onClick={() => void handleGeneratePreview()}
            disabled={!canGeneratePreview || isPreviewing}
            className="px-5 py-2.5 rounded-lg bg-brand-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            <span>{isPreviewing ? '生成中...' : (previewReady ? '重新生成网页预览' : '生成网页预览')}</span>
          </button>

          {previewInfo ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              预检通过：共 {previewInfo.page_count} 页，空白页 {previewInfo.blank_pages.length} 页。
            </div>
          ) : null}
          {previewErrorText ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {previewErrorText}
            </div>
          ) : null}
          <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
            {isLoadingPreviewFile ? (
              <div className="h-[740px] flex items-center justify-center text-slate-500 text-sm">预览加载中...</div>
            ) : previewBlobUrl ? (
              <iframe title="PDF网页预览" src={previewBlobUrl} className="w-full h-[740px] bg-white" />
            ) : (
              <div className="h-[320px] flex items-center justify-center text-slate-500 text-sm">
                尚未生成预览，请先点击“生成网页预览”。
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-900">变更摘要（本期 vs 上期）</h3>
            {loadingReviewData && <span className="text-xs text-slate-500">加载中...</span>}
          </div>
          {diffItems.length === 0 ? (
            <p className="text-sm text-slate-500">暂无差异数据。</p>
          ) : (
            <div className="space-y-2">
              {diffItems.map((item) => (
                <div key={item.key} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <div className="font-medium text-slate-700">{item.label}</div>
                  <div className="text-slate-500 text-xs mt-1">
                    本期: {formatAmount(item.current_value)} | 上期: {formatAmount(item.previous_value)} | 差额: {formatAmount(item.diff_value)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-3">回执与状态轨迹</h3>
          {receipt ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">回执号: <span className="font-mono">{receipt.receipt_no}</span></p>
              <div className="space-y-2">
                {receipt.timeline.map((item, idx) => (
                  <div key={`${item.action}-${idx}`} className="text-sm text-slate-600 flex justify-between">
                    <span>{item.label}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(item.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">尚未生成回执轨迹。</p>
          )}
        </div>
      </div>
    );
  };

  const renderDownloadSummary = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">下载报告文件</h3>
        {!previewReady ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            请先返回第8步生成并确认网页预览，再下载文件。
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            预览已完成。现在可直接下载 PDF 和 Excel，无需发布步骤。
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadPreviewPdf()}
            disabled={!previewReady}
            className="px-4 py-3 rounded-lg border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 disabled:bg-slate-200 disabled:text-slate-400 disabled:border-slate-200 inline-flex items-center justify-center gap-2"
          >
            <FileText className="w-4 h-4" />
            <span>下载PDF</span>
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadPreviewExcel()}
            disabled={!previewReady}
            className="px-4 py-3 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 disabled:bg-slate-200 disabled:text-slate-400 disabled:border-slate-200 inline-flex items-center justify-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>下载Excel</span>
          </button>
        </div>
        <div className="text-xs text-slate-500">
          下载记录：PDF {downloadedFlags.pdf ? '已下载' : '未下载'}，Excel {downloadedFlags.excel ? '已下载' : '未下载'}
        </div>
      </div>
    </div>
  );

  const renderDirectoryStage = () => {
    if (!draftId) {
      return null;
    }

    return (
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
        <aside className="xl:col-span-1 xl:sticky xl:top-24 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">目录进度</h3>
            <div className="space-y-2">
              {DIRECTORY_STEPS.map((step, index) => {
                const isCurrent = step.key === currentStep;
                const isCompleted = stepCompletion[step.key];
                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setCurrentStep(step.key)}
                    className={`w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${isCurrent ? 'bg-brand-50 border border-brand-200' : 'hover:bg-slate-50 border border-transparent'
                      }`}
                  >
                    <span className="mt-0.5">
                      {isCompleted ? (
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      ) : isCurrent ? (
                        <PlayCircle className="w-4 h-4 text-brand-600" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-300" />
                      )}
                    </span>
                    <span>
                      <span className={`block text-sm ${isCurrent ? 'text-brand-700 font-semibold' : 'text-slate-700'}`}>
                        {index + 1}. {step.label.replace(/^.、/, '')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-sm text-slate-600 space-y-2">
            <p>草稿 ID: <span className="font-mono text-slate-800">#{draftId}</span></p>
            <p>草稿状态: <span className="font-semibold text-brand-700">{draftMeta?.status || '-'}</span></p>
            <p>目录完成度: <span className="font-semibold text-brand-700">{directoryProgress}%</span></p>
            <p>第4节类款项未填: <span className="font-semibold text-red-600">{lineItemStats.missing}</span> 条</p>
            <p>第5节预算表识别: <span className="font-semibold text-brand-700">{budgetTableStats.ready}/{budgetTableStats.total || 9}</span></p>
            <p>Fatal 错误: <span className="font-semibold text-red-600">{fatalCount}</span></p>
          </div>
        </aside>

        <section className="xl:col-span-3 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{currentStepConfig.label}</h2>
                <p className="text-sm text-slate-500 mt-1">{currentStepConfig.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setStage('entry')}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                返回任务首页
              </button>
            </div>

            {currentStepConfig.type === 'manual' && currentStepConfig.section && (
              currentStepConfig.section === 'budget_explanation' ? (
                <BudgetExplanationComposer
                  draftId={draftId}
                  draftYear={draftMeta?.year || new Date().getFullYear()}
                  initialInputs={manualInputs}
                  ifMatchUpdatedAt={draftMeta?.updated_at || undefined}
                  onSaveManualInputs={handleManualInputsSave}
                  onReuseHistory={handleReuseHistory}
                  focusRequest={focusRequest}
                  onLineItemStatsChange={handleBudgetLineItemStatsChange}
                  onDraftUpdated={handleBudgetDraftUpdated}
                  onCompletionChange={handleBudgetCompletionChange}
                />
              ) : currentStepConfig.section === 'other_related' ? (
                <OtherRelatedComposer
                  draftId={draftId}
                  draftYear={draftMeta?.year || new Date().getFullYear()}
                  initialInputs={manualInputs}
                  onSaveManualInputs={handleManualInputsSave}
                  focusRequest={focusRequest}
                  onCompletionChange={(completed) => {
                    setLiveCompletion((prev) => ({ ...prev, other_related: completed }));
                  }}
                />
              ) : (
                <ManualInputsForm
                  draftId={draftId}
                  initialInputs={manualInputs}
                  section={currentStepConfig.section}
                  autoSave
                  onSave={handleManualInputsSave}
                  onReuseHistory={handleReuseHistory}
                  focusRequest={focusRequest}
                  onCompletionChange={(completed) => {
                    setLiveCompletion((prev) => ({ ...prev, [currentStepConfig.section as ManualFormSection]: completed }));
                  }}
                />
              )
            )}

            {currentStepConfig.type === 'line_items' && (
              <div className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-1">
                  <p>本步骤仅展示并核对部门预算表目录中的9张表。</p>
                  <p>“财政拨款支出主要内容逐条列示”已调整到第4步进行填写。</p>
                </div>
                <BudgetTablesViewer
                  draftId={draftId}
                  onStatusChange={handleBudgetTableStatusChange}
                />
              </div>
            )}

            {currentStepConfig.type === 'review' && renderPreviewReview()}
            {currentStepConfig.type === 'download' && renderDownloadSummary()}

            <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={handlePrevDirectoryStep}
                disabled={currentStepIndex <= 0}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={handleNextDirectoryStep}
                disabled={currentStepIndex >= DIRECTORY_STEPS.length - 1}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一步
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />

      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              T
            </div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">预决算报告智能生成系统</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full border border-slate-200">
              <User className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                {user?.username} <span className="text-slate-400">({user?.role})</span>
              </span>
            </div>
            {isAdminView && (
              <button
                onClick={() => navigate('/admin')}
                className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors duration-200 text-sm font-medium"
                title="管理后台"
              >
                <Settings className="w-4 h-4" />
                <span>管理后台</span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 w-full">
        {loadingDraftContext ? (
          <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-center text-slate-600">
            草稿加载中，请稍候...
          </div>
        ) : (
          <>
            {stage === 'entry' && renderEntryStage()}
            {stage === 'upload' && renderUploadStage()}
            {stage === 'directory' && renderDirectoryStage()}
          </>
        )}
      </main>
    </div>
  );
};
