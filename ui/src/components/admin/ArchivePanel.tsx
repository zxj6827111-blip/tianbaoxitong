import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileText, Download, Database, Save, CheckCircle2, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { DataParseModal } from './DataParseModal';

interface ArchivePanelProps {
  departmentId: string;
  unitId: string;
  year: number;
  historyYearCount?: number;
  onYearChange?: (year: number) => void;
  onFactsSaved?: () => void;
}

interface Report {
  id: string;
  report_type: 'BUDGET' | 'FINAL';
  file_name: string;
  file_size: number;
  created_at: string;
}

interface TextContent {
  id: string;
  report_type: 'BUDGET' | 'FINAL';
  category: string;
  content_text: string;
  updated_at: string;
}

type ReportType = 'BUDGET' | 'FINAL';
type CategoryKey = 'FUNCTION' | 'STRUCTURE' | 'TERMINOLOGY' | 'EXPLANATION_FISCAL_DETAIL';
type NormalCategoryKey = Exclude<CategoryKey, 'EXPLANATION_FISCAL_DETAIL'>;

type FiscalUsageItem = {
  id: string;
  className: string;
  typeName: string;
  itemName: string;
  amount: string;
  purpose: string;
};

const FISCAL_CATEGORY: CategoryKey = 'EXPLANATION_FISCAL_DETAIL';
const NORMAL_CATEGORIES: NormalCategoryKey[] = ['FUNCTION', 'STRUCTURE', 'TERMINOLOGY'];
const CATEGORIES: CategoryKey[] = [...NORMAL_CATEGORIES, FISCAL_CATEGORY];

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  FUNCTION: '主要职能',
  STRUCTURE: '机构设置',
  TERMINOLOGY: '名词解释',
  EXPLANATION_FISCAL_DETAIL: '财政拨款支出明细及用途'
};

const buildDraftKey = (reportType: ReportType, category: CategoryKey) => `${reportType}:${category}`;

const SENTENCE_END_REGEX = /[。；;!?？！]$/;
const FISCAL_SECTION_BREAK_KEYWORDS = [
  '名词解释',
  '机关运行经费',
  '政府采购',
  '国有资产',
  '预算绩效',
  '三公经费',
  '其他说明',
  '项目支出绩效',
  '部门收支总体情况',
  '部门收入总体情况',
  '部门支出总体情况'
];
const FISCAL_TABLE_START_KEYWORDS = [
  '编制部门',
  '单位：',
  '单位:',
  '本年收入',
  '本年支出',
  '收入预算',
  '支出预算',
  '功能分类科目名称',
  '财政拨款收入',
  '财政拨款支出',
  '三公经费',
  '机关运行经费'
];
const FISCAL_AMOUNT_REGEX = /[-+]?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:亿元|万元|元)/;
const FISCAL_HEADING_PREFIX_REGEX = /^(?:[一二三四五六七八九十百零〇\d]+[、.．]|第[一二三四五六七八九十百零〇\d]+(?:部分|章|节))/;

const CN_DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const CN_UNIT_MAP: Record<string, number> = {
  十: 10,
  百: 100
};

const parseChineseIndex = (raw: string): number | null => {
  const text = String(raw || '').trim();
  if (!text) return null;

  let total = 0;
  let current = 0;

  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(CN_DIGIT_MAP, ch)) {
      current = CN_DIGIT_MAP[ch];
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(CN_UNIT_MAP, ch)) {
      const unit = CN_UNIT_MAP[ch];
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
      continue;
    }

    return null;
  }

  total += current;
  return total > 0 ? total : null;
};

const getFiscalLineIndex = (line: string): { index: number; prefix: string } | null => {
  const text = line.trim();
  if (!text) return null;

  const arabicPatterns = [
    /^([（(]?\d{1,3}[）)]?[、.．]?)\s*/,
    /^(\d{1,3}[、.．])\s*/
  ];

  for (const pattern of arabicPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const numeric = Number(match[1].replace(/[^\d]/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) {
      return { index: numeric, prefix: match[0] };
    }
  }

  const chinesePatterns = [
    /^([（(]?[一二三四五六七八九十百零〇]{1,5}[）)]?[、.．]?)\s*/,
    /^([一二三四五六七八九十百零〇]{1,5}[、.．])\s*/
  ];

  for (const pattern of chinesePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const normalized = match[1].replace(/[（()）)、.．\s]/g, '');
    const numeric = parseChineseIndex(normalized);
    if (numeric) {
      return { index: numeric, prefix: match[0] };
    }
  }

  return null;
};

const stripFiscalLinePrefix = (line: string) => {
  const indexed = getFiscalLineIndex(line);
  if (indexed) {
    return line.slice(indexed.prefix.length).trim();
  }
  return line.trim();
};

const appendContinuation = (base: string, extra: string) =>
  `${base.trim()}${extra.trim()}`.replace(/\s+/g, '').trim();

const shouldStopFiscalParsing = (line: string) => {
  const trimmed = line.replace(/\s+/g, '').trim();
  if (!trimmed) return false;
  if (trimmed.includes('财政拨款支出主要内容如下')) return false;
  if (trimmed.includes('（类）') || trimmed.includes('（款）') || trimmed.includes('（项）')) return false;
  if (trimmed.includes('用于')) return false;

  const hasSentencePunctuation = /[，。；;：:]/.test(trimmed);
  const hasAmount = FISCAL_AMOUNT_REGEX.test(trimmed);
  const isHeadingLike = FISCAL_HEADING_PREFIX_REGEX.test(trimmed) || /^202\d年.*预算.*(?:说明|表)/.test(trimmed);
  const hasBreakKeyword = FISCAL_SECTION_BREAK_KEYWORDS.some((keyword) => trimmed.includes(keyword));
  const hasTableStartKeyword = FISCAL_TABLE_START_KEYWORDS.some((keyword) => trimmed.includes(keyword));

  if (hasTableStartKeyword && !trimmed.includes('主要用于')) return true;
  if (hasBreakKeyword && isHeadingLike) return true;
  if (hasBreakKeyword && !hasSentencePunctuation && trimmed.length <= 18) return true;
  if (isHeadingLike && !hasSentencePunctuation && !hasAmount && trimmed.length <= 24) return true;
  return false;
};

const parseFiscalLevels = (detail: string) => {
  let rest = detail.trim();
  let className = '';
  let typeName = '';
  let itemName = '';

  const takeLevel = (marker: '类' | '款' | '项') => {
    const match = rest.match(new RegExp(`^(.*?)[（(]${marker}[)）]`));
    if (!match) return '';
    const value = match[1].trim();
    rest = rest.slice(match[0].length).trim();
    return value;
  };

  className = takeLevel('类');
  typeName = takeLevel('款');
  itemName = takeLevel('项');
  if (!itemName && rest) itemName = rest;
  if (!className && !typeName && !itemName) itemName = detail.trim();

  return { className, typeName, itemName };
};

const parseSingleFiscalUsageItem = (line: string, index: number): FiscalUsageItem | null => {
  const cleaned = stripFiscalLinePrefix(line);
  if (!cleaned) return null;
  if (/^财政拨款支出主要内容如下[:：]?$/.test(cleaned)) return null;

  let detailPart = cleaned;
  let purpose = '';

  const purposeMatch = detailPart.match(/^(.*?)(?:[：:]\s*)?((?:主要)?用于.*)$/);
  if (purposeMatch) {
    detailPart = purposeMatch[1].replace(/[，,:：\s]+$/, '').trim();
    purpose = purposeMatch[2].trim().replace(/^主要用于/, '用于');
  } else {
    const splitByColon = detailPart.match(/^(.*?)[：:]\s*(.+)$/);
    if (splitByColon) {
      detailPart = splitByColon[1].trim();
      purpose = splitByColon[2].trim();
    } else {
      detailPart = detailPart.trim();
    }
  }

  const amountMatch = detailPart.match(/([-+]?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:亿元|万元|元))/);
  const amount = amountMatch ? amountMatch[1].replace(/\s+/g, '').replace(/万\s*元/g, '万元') : '';
  if (amountMatch) {
    detailPart = detailPart.replace(amountMatch[0], ' ');
  }

  const normalizedDetail = detailPart
    .replace(/[“”"']/g, '')
    .replace(/科目/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const { className, typeName, itemName } = parseFiscalLevels(normalizedDetail);

  return {
    id: `fiscal-${index}-${Math.random().toString(36).slice(2, 7)}`,
    className,
    typeName,
    itemName,
    amount,
    purpose
  };
};

const splitFiscalEntriesByNumber = (content: string): string[] => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: string[] = [];
  let currentParts: string[] = [];
  let hasNumberedStarted = false;
  let lastNumber = 0;
  let stopped = false;

  lines.forEach((line) => {
    if (stopped) return;
    const cleaned = stripFiscalLinePrefix(line);
    if (!cleaned) return;
    if (/^财政拨款支出主要内容如下[:：]?$/.test(cleaned)) return;

    const numbered = getFiscalLineIndex(line);
    if (numbered) {
      const currentNumber = numbered.index;

      if (hasNumberedStarted && currentNumber <= lastNumber) {
        stopped = true;
        return;
      }

      if (hasNumberedStarted && currentParts.length > 0) {
        entries.push(currentParts.join(''));
      }

      hasNumberedStarted = true;
      lastNumber = currentNumber;
      currentParts = [stripFiscalLinePrefix(line)];
      return;
    }

    if (!hasNumberedStarted) return;
    if (shouldStopFiscalParsing(cleaned)) {
      stopped = true;
      return;
    }
    currentParts.push(line);
  });

  if (hasNumberedStarted && currentParts.length > 0) {
    entries.push(currentParts.join(''));
  }

  return entries;
};

const mergeBrokenFiscalItems = (items: FiscalUsageItem[]): FiscalUsageItem[] => {
  const merged: FiscalUsageItem[] = [];

  items.forEach((item) => {
    const prev = merged[merged.length - 1];
    const isPurposeOnlyContinuation = !item.className.trim()
      && !item.typeName.trim()
      && !item.itemName.trim()
      && !item.amount.trim()
      && Boolean(item.purpose.trim());
    const isOrphanContinuation = !item.className.trim()
      && !item.typeName.trim()
      && !item.amount.trim()
      && !item.purpose.trim()
      && Boolean(item.itemName.trim());
    const normalizedItemName = item.itemName.replace(/[（）()]/g, '').trim();
    const isAmountPurposeContinuation = !item.className.trim()
      && !item.typeName.trim()
      && Boolean(item.amount.trim())
      && Boolean(item.purpose.trim())
      && (!normalizedItemName || normalizedItemName === '主要');

    if (isPurposeOnlyContinuation && prev) {
      const continuationPurpose = item.purpose.trim();
      prev.purpose = prev.purpose.trim()
        ? appendContinuation(prev.purpose, continuationPurpose)
        : continuationPurpose;
      return;
    }

    if (isAmountPurposeContinuation && prev && !prev.amount.trim()) {
      prev.amount = item.amount.trim();
      prev.purpose = prev.purpose.trim()
        ? appendContinuation(prev.purpose, item.purpose.trim())
        : item.purpose.trim();
      return;
    }

    if (!isOrphanContinuation || !prev) {
      merged.push(item);
      return;
    }

    const continuation = item.itemName.trim();
    const prevPurpose = prev.purpose.trim();
    const prevItem = prev.itemName.trim();

    if (prevPurpose && !SENTENCE_END_REGEX.test(prevPurpose)) {
      prev.purpose = appendContinuation(prevPurpose, continuation);
      return;
    }

    if (!prevPurpose && prevItem && !SENTENCE_END_REGEX.test(prevItem)) {
      prev.itemName = appendContinuation(prevItem, continuation);
      return;
    }

    if (prevPurpose && prevPurpose.length <= 10) {
      prev.purpose = appendContinuation(prevPurpose, continuation);
      return;
    }

    merged.push(item);
  });

  return merged;
};

const parseFiscalUsageItems = (content: string): FiscalUsageItem[] => {
  const numberedEntries = splitFiscalEntriesByNumber(content);
  if (numberedEntries.length > 0) {
    const parsed = numberedEntries
      .map((entry, index) => parseSingleFiscalUsageItem(entry, index))
      .filter((item): item is FiscalUsageItem => Boolean(item));
    return mergeBrokenFiscalItems(parsed);
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: FiscalUsageItem[] = [];
  let stopped = false;

  lines.forEach((line, index) => {
    if (stopped) return;

    const cleaned = stripFiscalLinePrefix(line);
    if (!cleaned) return;
    if (/^财政拨款支出主要内容如下[:：]?$/.test(cleaned)) return;
    if (items.length > 0 && shouldStopFiscalParsing(cleaned)) {
      stopped = true;
      return;
    }
    const parsed = parseSingleFiscalUsageItem(cleaned, index);
    if (!parsed) return;
    items.push(parsed);
  });

  return mergeBrokenFiscalItems(items);
};

const serializeFiscalUsageItems = (items: FiscalUsageItem[]): string =>
  items
    .map((item, index) => {
      const className = item.className.trim();
      const typeName = item.typeName.trim();
      const name = item.itemName.trim();
      const amount = item.amount.trim();
      const purpose = item.purpose.trim();
      const detail = [className ? `${className}（类）` : '', typeName ? `${typeName}（款）` : '', name ? `${name}（项）` : '']
        .filter(Boolean)
        .join('');

      const parts = [detail || [className, typeName, name].filter(Boolean).join(' '), amount, purpose].filter(Boolean);
      if (parts.length === 0) return '';
      return `${index + 1}. ${parts.join('；')}`;
    })
    .filter(Boolean)
    .join('\n');

const inferArchiveYearFromFileName = (fileName: string): number | null => {
  const fourDigitMatch = fileName.match(/(?:19|20)\d{2}/);
  if (fourDigitMatch) {
    return Number(fourDigitMatch[0]);
  }

  const twoDigitWithYearMatch = fileName.match(/(\d{2})(?:年|年度)/);
  if (!twoDigitWithYearMatch) return null;

  const twoDigit = Number(twoDigitWithYearMatch[1]);
  if (!Number.isInteger(twoDigit)) return null;
  return twoDigit >= 90 ? 1900 + twoDigit : 2000 + twoDigit;
};

const normalizeYears = (items: unknown): number[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'number') return item;
      if (item && typeof item === 'object' && 'year' in item) {
        return Number((item as { year: unknown }).year);
      }
      return Number.NaN;
    })
    .filter((value) => Number.isInteger(value));
};

const ArchivePanel: React.FC<ArchivePanelProps> = ({
  departmentId,
  unitId,
  year,
  historyYearCount = 0,
  onYearChange,
  onFactsSaved
}) => {
  const [reports, setReports] = useState<Report[]>([]);
  const [textContent, setTextContent] = useState<TextContent[]>([]);
  const [archiveYear, setArchiveYear] = useState<number>(year);
  const [archiveYearOptions, setArchiveYearOptions] = useState<number[]>([year]);
  const [manualYearOptions, setManualYearOptions] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingYear, setDeletingYear] = useState(false);
  const [selectedType, setSelectedType] = useState<ReportType>('BUDGET');
  const [parseModalOpen, setParseModalOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const [expandedCategory, setExpandedCategory] = useState<NormalCategoryKey>('FUNCTION');
  const [showFiscalRawEditor, setShowFiscalRawEditor] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [saveErrorMap, setSaveErrorMap] = useState<Record<string, string | undefined>>({});
  const [savedAtMap, setSavedAtMap] = useState<Record<string, string>>({});
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [fiscalItemsMap, setFiscalItemsMap] = useState<Record<string, FiscalUsageItem[]>>({});

  const fiscalSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setArchiveYear(year);
  }, [year]);

  useEffect(() => {
    loadArchives();
  }, [departmentId, archiveYear, selectedType]);

  useEffect(() => {
    loadArchiveYears();
  }, [departmentId, year]);

  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };

      CATEGORIES.forEach((category) => {
        const key = buildDraftKey(selectedType, category);
        const existing = textContent.find((item) => item.category === category && item.report_type === selectedType);
        const serverValue = existing?.content_text ?? '';

        if (!(key in next) || !dirtyMap[key]) {
          if (next[key] !== serverValue) {
            next[key] = serverValue;
            changed = true;
          }
        }
      });

      return changed ? next : prev;
    });
  }, [textContent, selectedType, dirtyMap]);

  useEffect(() => {
    setFiscalItemsMap((prev) => {
      const key = buildDraftKey(selectedType, FISCAL_CATEGORY);
      if (dirtyMap[key]) return prev;

      const parsed = parseFiscalUsageItems(drafts[key] ?? '');
      const prevSerialized = serializeFiscalUsageItems(prev[key] ?? []);
      const nextSerialized = serializeFiscalUsageItems(parsed);

      if (prevSerialized === nextSerialized) return prev;
      return { ...prev, [key]: parsed };
    });
  }, [drafts, dirtyMap, selectedType]);

  const hasUnsavedChanges = useMemo(
    () => CATEGORIES.some((category) => dirtyMap[buildDraftKey(selectedType, category)]),
    [dirtyMap, selectedType]
  );

  const unsavedCount = useMemo(
    () => CATEGORIES.filter((category) => dirtyMap[buildDraftKey(selectedType, category)]).length,
    [dirtyMap, selectedType]
  );

  const visibleReports = useMemo(
    () => reports.filter((report) => report.report_type === selectedType),
    [reports, selectedType]
  );
  const currentReport = visibleReports[0] ?? null;

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const loadArchives = async (targetYear: number = archiveYear) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/archives/departments/${departmentId}/years/${targetYear}?report_type=${selectedType}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) {
        throw new Error('加载归档数据失败');
      }

      const data = await response.json();
      setReports(data.reports || []);
      setTextContent(data.text_content || []);
    } catch (error) {
      console.error('Failed to load archives:', error);
      setReports([]);
      setTextContent([]);
    } finally {
      setLoading(false);
    }
  };

  const loadArchiveYears = async (options?: {
    preserveCurrentYear?: boolean;
    currentYear?: number;
    excludeYears?: number[];
  }) => {
    const preserveCurrentYear = options?.preserveCurrentYear !== false;
    const currentYear = Number.isInteger(options?.currentYear) ? Number(options?.currentYear) : archiveYear;
    const excludeYears = new Set((options?.excludeYears || []).filter((value) => Number.isInteger(value)));
    const authHeaders = {
      Authorization: `Bearer ${localStorage.getItem('auth_token')}`
    };

    try {
      const [archiveResult, historyResult] = await Promise.allSettled([
        fetch(`/api/admin/archives/departments/${departmentId}/years`, { headers: authHeaders }),
        fetch(`/api/admin/history/units/${unitId}/years`, { headers: authHeaders })
      ]);

      const archiveYears = (archiveResult.status === 'fulfilled' && archiveResult.value.ok)
        ? normalizeYears((await archiveResult.value.json()).years)
        : [];
      const historyYears = (historyResult.status === 'fulfilled' && historyResult.value.ok)
        ? normalizeYears((await historyResult.value.json()).years)
        : [];

      const mergedYears = [...archiveYears, ...historyYears, ...manualYearOptions];
      if (preserveCurrentYear && Number.isInteger(currentYear)) {
        mergedYears.push(currentYear);
      }

      const uniqueYears = Array.from(new Set(mergedYears))
        .filter((value) => !excludeYears.has(value))
        .sort((a, b) => b - a);
      const nextYears = uniqueYears.length > 0 ? uniqueYears : [currentYear];
      setArchiveYearOptions(nextYears);
      return nextYears;
    } catch (error) {
      console.error('Failed to load archive years:', error);
      const fallbackYears = [currentYear, ...manualYearOptions]
        .filter((value, index, list) => list.indexOf(value) === index)
        .filter((value) => !excludeYears.has(value));
      setArchiveYearOptions(fallbackYears);
      return fallbackYears;
    }
  };

  const updateArchiveYear = (nextYear: number) => {
    setArchiveYearOptions((prev) => (
      prev.includes(nextYear)
        ? prev
        : [nextYear, ...prev].sort((a, b) => b - a)
    ));
    setArchiveYear(nextYear);
    onYearChange?.(nextYear);
  };

  const resetDraftStateForYearSwitch = () => {
    setDrafts({});
    setDirtyMap({});
    setSavingMap({});
    setSaveErrorMap({});
    setSavedAtMap({});
    setFiscalItemsMap({});
    setShowFiscalRawEditor(false);
    setGlobalMessage(null);
  };

  const handleSwitchArchiveYear = (nextYear: number) => {
    if (nextYear === archiveYear) return;
    if (hasUnsavedChanges && !window.confirm('切换入库年度将丢弃当前未保存修改，确认继续吗？')) {
      return;
    }
    if (hasUnsavedChanges) {
      resetDraftStateForYearSwitch();
    }
    updateArchiveYear(nextYear);
  };

  const handleAddArchiveYear = () => {
    const input = window.prompt('请输入要新增的入库年份（例如：2023）');
    if (!input) return;

    const normalizedYear = input.trim().match(/(?:19|20)\d{2}/)?.[0];
    const nextYear = Number(normalizedYear);
    if (!Number.isInteger(nextYear) || nextYear < 2000 || nextYear > 2100) {
      alert('请输入 2000 到 2100 之间的有效年份。');
      return;
    }

    setManualYearOptions((prev) => (
      prev.includes(nextYear) ? prev : [...prev, nextYear]
    ));
    handleSwitchArchiveYear(nextYear);
  };

  const handleDeleteArchiveYear = async () => {
    if (archiveYearOptions.length <= 1) {
      alert('至少保留 1 个入库年份，无法继续删除。');
      return;
    }

    if (hasUnsavedChanges && !window.confirm('删除年份前将丢弃当前未保存修改，确认继续吗？')) {
      return;
    }
    if (hasUnsavedChanges) {
      resetDraftStateForYearSwitch();
    }

    const confirmed = window.confirm(
      `确认删除 ${archiveYear} 年吗？\n将删除该年已上传文件、文本内容、表格数据，以及该单位该年的自动入库数值（archive_parse）。此操作不可恢复。`
    );
    if (!confirmed) return;

    setDeletingYear(true);
    try {
      const response = await fetch(
        `/api/admin/archives/departments/${departmentId}/years/${archiveYear}?unit_id=${encodeURIComponent(unitId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('auth_token')}`
          }
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '删除年份失败');
      }

      setManualYearOptions((prev) => prev.filter((value) => value !== archiveYear));
      const refreshedYears = await loadArchiveYears({
        preserveCurrentYear: false,
        excludeYears: [archiveYear]
      });
      const nextYear = refreshedYears.find((value) => value !== archiveYear) ?? refreshedYears[0];
      if (Number.isInteger(nextYear)) {
        updateArchiveYear(nextYear);
      } else {
        setReports([]);
        setTextContent([]);
      }
      alert(`已删除 ${archiveYear} 年。`);
    } catch (error: unknown) {
      console.error('Delete year failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`删除失败: ${message}`);
    } finally {
      setDeletingYear(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    let uploadYear = archiveYear;
    const inferredYear = inferArchiveYearFromFileName(file.name);
    if (inferredYear && inferredYear !== archiveYear) {
      const useInferredYear = window.confirm(
        `文件名疑似为 ${inferredYear} 年，但当前入库年度是 ${archiveYear} 年。\n是否按 ${inferredYear} 年入库？`
      );
      if (useInferredYear) {
        uploadYear = inferredYear;
      }
    }

    if (currentReport && uploadYear === archiveYear) {
      const reportLabel = selectedType === 'BUDGET' ? '预算报告' : '决算报告';
      const confirmed = window.confirm(
        `当前类型已存在${reportLabel}：${currentReport.file_name}\n继续上传将覆盖该文件，是否继续？`
      );
      if (!confirmed) {
        e.target.value = '';
        return;
      }
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('department_id', departmentId);
      formData.append('year', String(uploadYear));
      formData.append('report_type', selectedType);

      const response = await fetch('/api/admin/archives/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: formData
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '上传失败');
      }

      await loadArchives(uploadYear);
      await loadArchiveYears();
      if (uploadYear !== archiveYear) {
        updateArchiveYear(uploadYear);
      }
      alert('上传成功，请点击“提取数据”并入库到年度字段。');
    } catch (error: unknown) {
      console.error('Upload error:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`上传失败: ${message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const saveTextContent = async (category: CategoryKey, content: string) => {
    const key = buildDraftKey(selectedType, category);
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      setSaveErrorMap((prev) => ({ ...prev, [key]: '内容不能为空' }));
      return false;
    }

    setSavingMap((prev) => ({ ...prev, [key]: true }));
    setSaveErrorMap((prev) => ({ ...prev, [key]: undefined }));

    try {
      const response = await fetch('/api/admin/archives/text-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          department_id: departmentId,
          year: archiveYear,
          report_type: selectedType,
          category,
          content_text: trimmedContent
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '保存失败');
      }

      const data: { text_content?: TextContent } = await response.json();
      const saved = data.text_content;
      const nowIso = new Date().toISOString();

      setTextContent((prev) => {
        const rest = prev.filter((item) => !(item.report_type === selectedType && item.category === category));
        return [
          ...rest,
          saved ?? {
            id: key,
            report_type: selectedType,
            category,
            content_text: trimmedContent,
            updated_at: nowIso
          }
        ];
      });

      setDrafts((prev) => ({ ...prev, [key]: trimmedContent }));
      setDirtyMap((prev) => ({ ...prev, [key]: false }));
      setSavedAtMap((prev) => ({ ...prev, [key]: saved?.updated_at ?? nowIso }));
      return true;
    } catch (error: unknown) {
      console.error('Save text content error:', error);
      const message = error instanceof Error ? error.message : '文本保存失败';
      setSaveErrorMap((prev) => ({ ...prev, [key]: message }));
      return false;
    } finally {
      setSavingMap((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleParseSave = async (items: any[]) => {
    if (!selectedReportId) return;

    const response = await fetch('/api/admin/archives/save-budget-facts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({
        report_id: selectedReportId,
        unit_id: unitId,
        items
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || '数据入库失败');
    }

    const data = await response.json();
    onFactsSaved?.();

    const autoMapped = Number(data.auto_mapped_count || 0);
    const mapped = Number(data.mapped_count || 0);
    const upserted = Number(data.upserted_count || 0);
    const unmatched = Number(data.unmatched_count || 0);

    alert(`入库完成：自动识别 ${autoMapped} 项，总识别 ${mapped} 项，写入 ${upserted} 项，未匹配 ${unmatched} 项。`);
  };

  const handleDraftChange = (category: CategoryKey, value: string) => {
    const key = buildDraftKey(selectedType, category);
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setDirtyMap((prev) => ({ ...prev, [key]: true }));
    setSaveErrorMap((prev) => ({ ...prev, [key]: undefined }));

    if (category === FISCAL_CATEGORY) {
      setFiscalItemsMap((prev) => ({ ...prev, [key]: parseFiscalUsageItems(value) }));
    }
  };

  const handleSaveCategory = async (category: CategoryKey) => {
    const key = buildDraftKey(selectedType, category);
    const success = await saveTextContent(category, drafts[key] ?? '');
    if (success) {
      setGlobalMessage(`已保存“${CATEGORY_LABELS[category]}”`);
      window.setTimeout(() => setGlobalMessage(null), 2500);
    }
  };

  const handleSaveAll = async () => {
    const dirtyCategories = CATEGORIES.filter((category) => dirtyMap[buildDraftKey(selectedType, category)]);

    if (dirtyCategories.length === 0) {
      setGlobalMessage('当前没有待保存内容');
      window.setTimeout(() => setGlobalMessage(null), 2000);
      return;
    }

    let successCount = 0;
    for (const category of dirtyCategories) {
      // eslint-disable-next-line no-await-in-loop
      const success = await saveTextContent(category, drafts[buildDraftKey(selectedType, category)] ?? '');
      if (success) successCount += 1;
    }

    if (successCount === dirtyCategories.length) {
      setGlobalMessage('全部内容已保存');
    } else {
      setGlobalMessage(`已保存 ${successCount}/${dirtyCategories.length} 个分区，请检查失败项`);
    }

    window.setTimeout(() => setGlobalMessage(null), 3000);
  };

  const handleDiscardAll = () => {
    if (!window.confirm('确认放弃当前类型下所有未保存修改吗？')) return;

    setDrafts((prev) => {
      const next = { ...prev };
      CATEGORIES.forEach((category) => {
        const key = buildDraftKey(selectedType, category);
        const existing = textContent.find((item) => item.category === category && item.report_type === selectedType);
        next[key] = existing?.content_text ?? '';
      });
      return next;
    });

    setDirtyMap((prev) => {
      const next = { ...prev };
      CATEGORIES.forEach((category) => {
        next[buildDraftKey(selectedType, category)] = false;
      });
      return next;
    });

    setSaveErrorMap((prev) => {
      const next = { ...prev };
      CATEGORIES.forEach((category) => {
        next[buildDraftKey(selectedType, category)] = undefined;
      });
      return next;
    });

    setFiscalItemsMap((prev) => {
      const key = buildDraftKey(selectedType, FISCAL_CATEGORY);
      const existing = textContent.find((item) => item.category === FISCAL_CATEGORY && item.report_type === selectedType);
      return { ...prev, [key]: parseFiscalUsageItems(existing?.content_text ?? '') };
    });

    setShowFiscalRawEditor(false);
    setGlobalMessage('已放弃未保存修改');
    window.setTimeout(() => setGlobalMessage(null), 2000);
  };

  const updateFiscalItems = (updater: (items: FiscalUsageItem[]) => FiscalUsageItem[]) => {
    const key = buildDraftKey(selectedType, FISCAL_CATEGORY);

    setFiscalItemsMap((prev) => {
      const current = prev[key] ?? [];
      const nextItems = updater(current);
      const nextText = serializeFiscalUsageItems(nextItems);

      setDrafts((draftPrev) => ({ ...draftPrev, [key]: nextText }));
      setDirtyMap((dirtyPrev) => ({ ...dirtyPrev, [key]: true }));
      setSaveErrorMap((errorPrev) => ({ ...errorPrev, [key]: undefined }));

      return { ...prev, [key]: nextItems };
    });
  };

  const handleAddFiscalItem = () => {
    updateFiscalItems((items) => [
      ...items,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        className: '',
        typeName: '',
        itemName: '',
        amount: '',
        purpose: ''
      }
    ]);
  };

  const handleUpdateFiscalItem = (targetId: string, patch: Partial<FiscalUsageItem>) => {
    updateFiscalItems((items) => items.map((item) => (item.id === targetId ? { ...item, ...patch } : item)));
  };

  const handleRemoveFiscalItem = (targetId: string) => {
    updateFiscalItems((items) => items.filter((item) => item.id !== targetId));
  };

  if (loading) {
    return <div className="p-4 text-sm text-slate-500">正在加载历史归档...</div>;
  }

  const activeCategory = expandedCategory;
  const activeKey = buildDraftKey(selectedType, activeCategory);
  const activeExisting = textContent.find((item) => item.category === activeCategory && item.report_type === selectedType);
  const activeDraft = drafts[activeKey] ?? activeExisting?.content_text ?? '';
  const activeHasContent = Boolean(activeDraft.trim());
  const activeIsDirty = Boolean(dirtyMap[activeKey]);
  const activeIsSaving = Boolean(savingMap[activeKey]);
  const activeSaveError = saveErrorMap[activeKey];
  const activeSavedAt = savedAtMap[activeKey] || activeExisting?.updated_at;

  const fiscalKey = buildDraftKey(selectedType, FISCAL_CATEGORY);
  const fiscalExisting = textContent.find((item) => item.category === FISCAL_CATEGORY && item.report_type === selectedType);
  const fiscalDraft = drafts[fiscalKey] ?? fiscalExisting?.content_text ?? '';
  const fiscalItems = fiscalItemsMap[fiscalKey] ?? [];
  const fiscalIsDirty = Boolean(dirtyMap[fiscalKey]);
  const fiscalIsSaving = Boolean(savingMap[fiscalKey]);
  const fiscalSaveError = saveErrorMap[fiscalKey];
  const fiscalSavedAt = savedAtMap[fiscalKey] || fiscalExisting?.updated_at;

  return (
    <div className="space-y-6 pb-2">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Upload className="w-4 h-4" />
            上传年度报告 PDF
          </h3>
          <div className="text-slate-500 flex flex-col items-end gap-1">
            <label className="text-sm inline-flex items-center gap-2">
              <span>入库年度：</span>
              <select
                value={archiveYear}
                onChange={(event) => handleSwitchArchiveYear(Number(event.target.value))}
                className="bg-white border border-slate-300 rounded px-2 py-0.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {archiveYearOptions.map((optionYear) => (
                  <option key={optionYear} value={optionYear}>{optionYear}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddArchiveYear}
                className="px-2 py-0.5 text-xs border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
              >
                新增年份
              </button>
              <button
                type="button"
                onClick={handleDeleteArchiveYear}
                disabled={deletingYear}
                className="px-2 py-0.5 text-xs border border-red-300 rounded text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                {deletingYear ? '删除中...' : '删除年份'}
              </button>
            </label>
            <span className="text-xs text-slate-500">共 {historyYearCount} 个归档年份</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setSelectedType('BUDGET')}
            className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              selectedType === 'BUDGET'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            预算报告
          </button>
          <button
            onClick={() => setSelectedType('FINAL')}
            className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              selectedType === 'FINAL'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            决算报告
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          当前规则：同一部门、同一入库年度、同一报告类型仅保留 1 份文件。再次上传会覆盖旧文件。
        </div>

        <label className="block">
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-5 text-center hover:border-brand-400 transition-colors cursor-pointer bg-slate-50/40">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
            <FileText className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-700 font-medium">
              {uploading ? '上传中...' : `点击上传${selectedType === 'BUDGET' ? '预算' : '决算'} PDF`}
            </p>
          </div>
        </label>
      </section>

      <section className="space-y-4">
        <div className="border border-slate-200 rounded-xl bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-bold text-slate-800">当前已上传文件</h3>
            {currentReport ? <span className="text-xs text-amber-700">再次上传将覆盖</span> : null}
          </div>

          {currentReport ? (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate" title={currentReport.file_name}>
                    {currentReport.file_name}
                  </div>
                  <div className="text-sm text-slate-500">{(currentReport.file_size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="text-sm bg-white text-slate-600 border px-3 py-1.5 rounded hover:bg-slate-50 flex items-center gap-1"
                  onClick={() => {
                    setSelectedReportId(currentReport.id);
                    setParseModalOpen(true);
                  }}
                >
                  <Download className="w-3 h-3" />
                  提取数据
                </button>
                <span className="text-xs text-slate-400">{new Date(currentReport.created_at).toLocaleDateString('zh-CN')}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              当前类型下暂无已上传文件，请先上传 PDF。
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-xl bg-white p-4 space-y-4 h-fit">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Database className="w-4 h-4" />
                可复用文本内容
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                三类常用文本在此编辑，“财政拨款支出明细及用途”已拆到下方独立区域，避免双滚动干扰。
              </p>
            </div>
            {globalMessage && (
              <div className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200">{globalMessage}</div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3 items-start">
            <div className="border border-slate-200 rounded-xl bg-slate-50/50 p-2 space-y-1 lg:sticky lg:top-2">
              {NORMAL_CATEGORIES.map((category) => {
                const key = buildDraftKey(selectedType, category);
                const existing = textContent.find((item) => item.category === category && item.report_type === selectedType);
                const draft = drafts[key] ?? existing?.content_text ?? '';
                const hasContent = Boolean(draft.trim());
                const isDirty = Boolean(dirtyMap[key]);

                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setExpandedCategory(category)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      activeCategory === category
                        ? 'bg-brand-50 text-brand-700 border-brand-200'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{CATEGORY_LABELS[category]}</span>
                      <span className="text-xs text-slate-400 shrink-0">{draft.length} 字</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {hasContent && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="已填写" />}
                      {isDirty ? <span className="text-amber-600">未保存</span> : <span className="text-slate-400">已同步</span>}
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 transition-colors"
                onClick={() => fiscalSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700 truncate">财政拨款支出明细及用途</span>
                  <span className="text-xs text-slate-400 shrink-0">{fiscalDraft.length} 字</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="text-brand-600">独立编辑区</span>
                  {fiscalIsDirty && <span className="text-amber-600">未保存</span>}
                </div>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl bg-slate-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{CATEGORY_LABELS[activeCategory]}</div>
                  <div className="text-xs text-slate-500 mt-1">{activeHasContent ? `已填写 ${activeDraft.length} 字` : '暂无内容'}</div>
                </div>
                <button
                  className="text-sm bg-white text-slate-700 border px-3 py-1.5 rounded hover:bg-slate-50 flex items-center gap-1 disabled:opacity-60"
                  onClick={() => handleSaveCategory(activeCategory)}
                  disabled={activeIsSaving || !activeIsDirty}
                >
                  <Save className="w-3.5 h-3.5" />
                  保存
                </button>
              </div>

              <div className="text-xs">
                {activeIsSaving ? (
                  <span className="text-brand-600">保存中...</span>
                ) : activeSaveError ? (
                  <span className="text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {activeSaveError}
                  </span>
                ) : activeSavedAt ? (
                  <span className="text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    已保存于 {new Date(activeSavedAt).toLocaleString('zh-CN')}
                  </span>
                ) : (
                  <span className="text-slate-400">尚未保存</span>
                )}
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">正文</div>
                <textarea
                  className="w-full px-3 py-3 text-base leading-7 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y bg-white min-h-[320px]"
                  value={activeDraft}
                  placeholder={`请输入${CATEGORY_LABELS[activeCategory]}...`}
                  onChange={(event) => handleDraftChange(activeCategory, event.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div ref={fiscalSectionRef} className="border border-slate-200 rounded-xl bg-white p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">财政拨款支出明细及用途</h3>
            <p className="text-sm text-slate-500 mt-1">独立编辑区。为避免双滚动干扰，条目列表取消内部滚动，页面统一滚动查看。</p>
          </div>
          <button
            className="text-sm bg-white text-slate-700 border px-3 py-1.5 rounded hover:bg-slate-50 flex items-center gap-1 disabled:opacity-60"
            onClick={() => handleSaveCategory(FISCAL_CATEGORY)}
            disabled={fiscalIsSaving || !fiscalIsDirty}
          >
            <Save className="w-3.5 h-3.5" />
            保存
          </button>
        </div>

        <div className="text-xs">
          {fiscalIsSaving ? (
            <span className="text-brand-600">保存中...</span>
          ) : fiscalSaveError ? (
            <span className="text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {fiscalSaveError}
            </span>
          ) : fiscalSavedAt ? (
            <span className="text-slate-500 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              已保存于 {new Date(fiscalSavedAt).toLocaleString('zh-CN')}
            </span>
          ) : (
            <span className="text-slate-400">尚未保存</span>
          )}
        </div>

        <div className="space-y-3 border border-slate-200 rounded-lg bg-slate-50/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">将条目拆成“类 + 款 + 项 + 金额 + 用于理由”，每条可独立编辑。</div>
            <button
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded text-slate-700 hover:bg-slate-50 bg-white"
              onClick={handleAddFiscalItem}
            >
              <Plus className="w-3.5 h-3.5" />
              新增条目
            </button>
          </div>

          {fiscalItems.length === 0 ? (
            <div className="text-xs text-slate-500 bg-white rounded border border-dashed border-slate-300 p-3">
              当前未识别到条目。你可以点击“新增条目”手动补充。
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden xl:grid xl:grid-cols-[72px_minmax(120px,0.7fr)_minmax(120px,0.7fr)_minmax(180px,1fr)_minmax(120px,0.6fr)_minmax(260px,1.4fr)_auto] gap-2 px-2 text-xs text-slate-500">
                <span>序号</span>
                <span>类</span>
                <span>款</span>
                <span>项</span>
                <span>金额</span>
                <span>用于理由</span>
                <span />
              </div>
              {fiscalItems.map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-1 xl:grid-cols-[72px_minmax(120px,0.7fr)_minmax(120px,0.7fr)_minmax(180px,1fr)_minmax(120px,0.6fr)_minmax(260px,1.4fr)_auto] gap-2 items-start p-2 border border-slate-200 rounded bg-white"
                >
                  <div className="inline-flex items-center justify-center px-2 py-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded">
                    第 {index + 1} 条
                  </div>
                  <input
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={item.className}
                    onChange={(event) => handleUpdateFiscalItem(item.id, { className: event.target.value })}
                    placeholder={`第 ${index + 1} 条：类`}
                  />
                  <input
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={item.typeName}
                    onChange={(event) => handleUpdateFiscalItem(item.id, { typeName: event.target.value })}
                    placeholder={`第 ${index + 1} 条：款`}
                  />
                  <input
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={item.itemName}
                    onChange={(event) => handleUpdateFiscalItem(item.id, { itemName: event.target.value })}
                    placeholder={`第 ${index + 1} 条：项`}
                  />
                  <input
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={item.amount}
                    onChange={(event) => handleUpdateFiscalItem(item.id, { amount: event.target.value })}
                    placeholder="金额（如：3.83万元）"
                  />
                  <textarea
                    className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500 min-h-[72px] resize-y"
                    value={item.purpose}
                    onChange={(event) => handleUpdateFiscalItem(item.id, { purpose: event.target.value })}
                    placeholder="用于理由（如：用于人员经费、公用经费、专项业务支出等）"
                  />
                  <button
                    className="px-2 py-2 border rounded text-slate-500 hover:text-red-600 hover:border-red-300"
                    onClick={() => handleRemoveFiscalItem(item.id)}
                    title="删除条目"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowFiscalRawEditor((prev) => !prev)}
            className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-100"
          >
            {showFiscalRawEditor ? '收起原文编辑' : '展开原文编辑'}
          </button>
          {showFiscalRawEditor && (
            <div>
              <div className="text-xs text-slate-500 mb-1">原文（可直接编辑）</div>
              <textarea
                className="w-full px-3 py-3 text-base leading-7 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y bg-white min-h-[260px]"
                value={fiscalDraft}
                placeholder="请输入财政拨款支出明细及用途..."
                onChange={(event) => handleDraftChange(FISCAL_CATEGORY, event.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {hasUnsavedChanges && (
        <div className="sticky bottom-0 z-10 border border-slate-200 bg-white/95 backdrop-blur rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-600">当前有 {unsavedCount} 个分区未保存</span>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-50" onClick={handleDiscardAll}>
              放弃修改
            </button>
            <button className="px-3 py-1.5 text-sm rounded bg-brand-600 text-white hover:bg-brand-700" onClick={handleSaveAll}>
              保存全部
            </button>
          </div>
        </div>
      )}

      {selectedReportId && (
        <DataParseModal
          isOpen={parseModalOpen}
          onClose={() => setParseModalOpen(false)}
          reportId={selectedReportId}
          onSave={handleParseSave}
        />
      )}
    </div>
  );
};

export default ArchivePanel;


