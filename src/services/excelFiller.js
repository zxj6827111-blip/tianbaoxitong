const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const normalizeUnitName = (raw) => {
  if (!raw) return '';
  let text = String(raw).trim();
  text = text.replace(/预算单位[:：]?/, '').trim();
  text = text.replace(/（?单位）?主要职能.*$/, '').trim();
  text = text.replace(/主要职能.*$/, '').trim();
  return text;
};

const resolveManualText = (values, key) => {
  const input = values?.manual_inputs?.[key];
  if (!input) return '';
  if (input.value_text) return String(input.value_text).trim();
  if (input.value_json !== null && input.value_json !== undefined) {
    return typeof input.value_json === 'string' ? input.value_json : JSON.stringify(input.value_json);
  }
  return '';
};

const ensureSentence = (text) => {
  const trimmed = String(text || '').trim().replace(/[。；;,.]+$/g, '');
  return trimmed ? `${trimmed}。` : '';
};

const normalizeReason = (text) => String(text || '')
  .trim()
  .replace(/^主要用于[:：]?\s*/g, '')
  .replace(/^主要原因是[:：]?\s*/g, '')
  .replace(/\d{4}年(?:当年)?预算执行数[^。；;\n]*[。；;]?/g, '')
  .replace(/上年(?:预算)?执行数[^。；;\n]*[。；;]?/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const compactReason = (text) => {
  const normalized = normalizeReason(text);
  if (!normalized) return '';
  const firstSentence = normalized.split(/[。；;]/).map((part) => part.trim()).find(Boolean) || normalized;
  const clipped = firstSentence.length > 48 ? `${firstSentence.slice(0, 48)}...` : firstSentence;
  return clipped;
};

const buildLineItemLines = (values) => {
  const items = Array.isArray(values?.line_items_reason) ? values.line_items_reason : [];
  return items
    .map((item, index) => {
      const amountValue = Number(item.amount_current_wanyuan);
      if (!Number.isFinite(amountValue) || amountValue <= 0) return null;
      const amountText = amountValue.toFixed(2);
      const rawReason = item.reason_text && String(item.reason_text).trim()
        ? String(item.reason_text).trim()
        : '';

      // If reason text is already a full sentence with amount context, keep it as-is.
      if (rawReason && /万元/.test(rawReason)) {
        return `${index + 1}. ${ensureSentence(rawReason)}`;
      }

      const reason = compactReason(rawReason) || '待填写';
      return `${index + 1}. “${item.item_label}”科目${amountText}万元，主要用于${ensureSentence(reason)}`;
    })
    .filter(Boolean);
};

const normalizeBudgetChangeReason = (text) => {
  const reason = String(text || '')
    .trim()
    .replace(/^财政拨款收入支出增加（减少）的主要原因是[:：]?\s*/g, '')
    .replace(/^主要原因是[:：]?\s*/g, '')
    .trim();
  return reason || '';
};

const buildProjectExpenseBlock = (values) => {
  const read = (key) => resolveManualText(values, key);

  const overview = read('project_overview');
  const basis = read('project_basis');
  const subject = read('project_subject');
  const plan = read('project_plan');
  const cycle = read('project_cycle');
  const budgetArrangement = read('project_budget_arrangement');
  const performanceGoal = read('project_performance_goal')
    || read('performance_target')
    || read('performance_result');

  const sections = [
    { title: '一、项目概述', text: overview },
    { title: '二、立项依据', text: basis },
    { title: '三、实施主体', text: subject },
    { title: '四、实施方案', text: plan },
    { title: '五、实施周期', text: cycle },
    { title: '六、年度预算安排', text: budgetArrangement },
    { title: '七、绩效目标', text: performanceGoal }
  ];

  const lines = ['七、项目经费情况说明'];
  for (const section of sections) {
    lines.push(section.title);
    lines.push(section.text && section.text.trim() ? section.text.trim() : '无');
  }
  return lines.join('\n');
};

const buildPayload = ({ values, year }) => {
  const resolvedYear = Number.isFinite(Number(year)) ? Number(year) : new Date().getFullYear();
  const unitName = normalizeUnitName(resolveManualText(values, 'unit_full_name'))
    || normalizeUnitName(resolveManualText(values, 'main_functions'));
  const budgetExplanation = resolveManualText(values, 'budget_explanation');
  const budgetChangeReason = normalizeBudgetChangeReason(resolveManualText(values, 'budget_change_reason'));
  const otherNotes = resolveManualText(values, 'other_notes');
  const projectExpenseBlock = buildProjectExpenseBlock(values);
  const mergedOtherNotes = /项目经费情况说明/.test(otherNotes)
    ? otherNotes
    : [otherNotes, projectExpenseBlock].filter(Boolean).join('\n\n');
  const explanationLines = [];
  if (budgetExplanation) {
    explanationLines.push(budgetExplanation);
  }

  const hasReasonLine = /财政拨款收入支出增加（减少）的主要原因是/.test(budgetExplanation);
  if (!hasReasonLine) {
    explanationLines.push(`财政拨款收入支出增加（减少）的主要原因是${ensureSentence(budgetChangeReason || '待填写')}`);
  }

  explanationLines.push('财政拨款支出主要内容如下：');
  const explanationBlock = explanationLines.filter(Boolean).join('\n');

  return {
    year: resolvedYear,
    prevYear: resolvedYear - 1,
    unitName,
    coverUnitText: unitName ? `预算单位：${unitName}` : '',
    sheetMap: [
      { sourceCandidates: ['2.11单位职能（单位）', '3.11部门主要职能（部门）'], target: '单位职能' },
      { sourceCandidates: ['2.12单位机构设置（单位）', '3.12部门机构设置（部门）'], target: '单位机构设置' },
      { sourceCandidates: ['2.13名词解释（单位）', '3.13名词解释（部门）'], target: '名词解释' },
      { sourceCandidates: ['2.14单位编制说明（单位）', '3.14部门编制说明（部门）'], target: '单位编制说明' },
      { sourceCandidates: ['2.15单位收支总表', '3.15部门收支总表'], target: '单位收支总表' },
      { sourceCandidates: ['2.16单位收入总表', '3.16部门收入总表'], target: '单位收入总表' },
      { sourceCandidates: ['2.17单位支出总表', '3.17部门支出总表'], target: '单位支出总表' },
      { sourceCandidates: ['2.18单位财政拨款收支总表', '3.19部门财政拨款收支总表'], target: '单位财政拨款收支总表' },
      { sourceCandidates: ['2.20单位一般公共预算拨款表', '3.21部门一般公共预算支出功能分类预算表'], target: '单位一般公共预算拨款表' },
      { sourceCandidates: ['2.21单位政府性基金拨款表', '3.22部门政府性基金预算支出功能分类预算表'], target: '单位政府性基金拨款表' },
      { sourceCandidates: ['2.22单位国有资本经营预算拨款表 ', '3.23部门国有资本经营预算支出功能分类预算表'], target: '单位国有资本经营预算拨款表 ' },
      { sourceCandidates: ['2.23单位一般公共预算拨款基本支出明细表', '3.24部门一般公共预算基本支出部门预算经济分类预算表'], target: '单位一般公共预算拨款基本支出明细表' },
      { sourceCandidates: ['2.25单位“三公”经费和机关运行费预算表', '3.25部门“三公”经费和机关运行经费预算表'], target: '单位“三公”经费和机关运行费预算表' },
      { sourceCandidates: ['2.26其他相关情况说明（单位）', '3.26其他相关情况说明（部门）'], target: '其他相关情况说明' }
    ],
    sheetNames: {
      cover: '封面',
      directory: '目录',
      explanation: '单位编制说明',
      functions: '单位职能',
      org: '单位机构设置',
      glossary: '名词解释',
      other: '其他相关情况说明'
    },
    yearUpdateSheets: ['封面', '目录', '单位编制说明', '其他相关情况说明'],
    manualTexts: {
      main_functions: resolveManualText(values, 'main_functions'),
      organizational_structure: resolveManualText(values, 'organizational_structure'),
      glossary: resolveManualText(values, 'glossary'),
      other_notes: mergedOtherNotes,
      explanation_block: explanationBlock
    },
    lineItemLines: buildLineItemLines(values)
  };
};

const fillExcelTemplate = async ({ templatePath, sourcePath, outputPath, values, year }) => {
  if (!sourcePath) {
    throw new Error('sourcePath is required to fill Excel template');
  }

  const payload = buildPayload({ values, year });
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'fill_excel_template.ps1');

  try {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ], {
      env: {
        ...process.env,
        TEMPLATE_PATH: templatePath,
        SOURCE_PATH: sourcePath,
        OUTPUT_PATH: outputPath,
        PAYLOAD_BASE64: payloadBase64
      }
    });
  } catch (error) {
    const stderr = String(error?.stderr || '');
    const stdout = String(error?.stdout || '');
    const combined = `${stderr}\n${stdout}`;
    const isComFailure = /0x800A03EC|COMException|HRESULT/i.test(combined);
    const isCopyFailure = /Copy-Item|Copy template failed/i.test(combined);
    const isTemplateMissing = /Template file not found/i.test(combined);
    const isSourceMissing = /Source file not found/i.test(combined);
    const hint = isComFailure
      ? '模板处理失败（WPS/Excel COM异常）。请关闭所有WPS/Excel窗口后重试。'
      : isTemplateMissing
        ? '模板处理失败：模板文件不存在。请确认模板文件路径与部署目录。'
        : isSourceMissing
          ? '模板处理失败：源预算文件不存在。请重新上传后重试。'
        : isCopyFailure
          ? '模板处理失败：复制模板文件失败。请确认模板文件可访问且没有被占用。'
      : '模板处理失败，请检查模板文件是否可读写并重试。';
    const detailLineRaw = combined
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    const detailLine = detailLineRaw
      ? detailLineRaw.replace(/[^\x20-\x7E\u4e00-\u9fa5:：()\-_.\\/\s]/g, '').trim()
      : '';
    const shouldAttachDetail = !isCopyFailure && !isTemplateMissing && !isSourceMissing;
    const err = new Error(shouldAttachDetail && detailLine ? `${hint} 详情: ${detailLine}` : hint);
    err.cause = error;
    throw err;
  }
};

module.exports = { fillExcelTemplate };
module.exports.__private = {
  buildPayload,
  buildProjectExpenseBlock
};
