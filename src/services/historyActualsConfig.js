const { BUDGET_MAPPING } = require('./budgetMapping');

const HISTORY_ACTUAL_KEYS = Array.from(new Set([
  ...BUDGET_MAPPING.map((item) => item.key),
  'operation_fund'
]));

const HISTORY_ACTUAL_FIELD_DEFS = [
  { key: 'budget_revenue_total', label: '收入预算合计（万元）', group: '收支预算', required: true },
  { key: 'budget_revenue_fiscal', label: '财政拨款收入（万元）', group: '收支预算', required: true },
  { key: 'budget_revenue_business', label: '事业收入（万元）', group: '收支预算', required: false },
  { key: 'budget_revenue_operation', label: '事业单位经营收入（万元）', group: '收支预算', required: false },
  { key: 'budget_revenue_other', label: '其他收入（万元）', group: '收支预算', required: false },
  { key: 'budget_expenditure_total', label: '支出预算合计（万元）', group: '收支预算', required: true },
  { key: 'budget_expenditure_basic', label: '基本支出（万元）', group: '收支预算', required: true },
  { key: 'budget_expenditure_project', label: '项目支出（万元）', group: '收支预算', required: true },
  { key: 'fiscal_grant_revenue_total', label: '财政拨款收入合计（万元）', group: '财政拨款', required: true },
  { key: 'fiscal_grant_expenditure_total', label: '财政拨款支出合计（万元）', group: '财政拨款', required: true },
  { key: 'fiscal_grant_expenditure_general', label: '一般公共预算财政拨款支出（万元）', group: '财政拨款', required: true },
  { key: 'fiscal_grant_expenditure_gov_fund', label: '政府性基金预算财政拨款支出（万元）', group: '财政拨款', required: false },
  { key: 'fiscal_grant_expenditure_capital', label: '国有资本经营预算财政拨款支出（万元）', group: '财政拨款', required: false },
  { key: 'three_public_total', label: '“三公”经费合计（万元）', group: '三公经费', required: true },
  { key: 'three_public_outbound', label: '因公出国（境）费（万元）', group: '三公经费', required: false },
  { key: 'three_public_vehicle_total', label: '公务用车购置及运行费（万元）', group: '三公经费', required: false },
  { key: 'three_public_vehicle_purchase', label: '公务用车购置费（万元）', group: '三公经费', required: false },
  { key: 'three_public_vehicle_operation', label: '公务用车运行费（万元）', group: '三公经费', required: false },
  { key: 'three_public_reception', label: '公务接待费（万元）', group: '三公经费', required: false },
  { key: 'operation_fund', label: '机关运行经费预算数（万元）', group: '三公经费', required: true }
];

const getRequiredHistoryActualKeys = () => {
  return HISTORY_ACTUAL_FIELD_DEFS
    .filter((field) => field.required)
    .map((field) => field.key);
};

module.exports = {
  HISTORY_ACTUAL_KEYS,
  HISTORY_ACTUAL_FIELD_DEFS,
  getRequiredHistoryActualKeys
};
