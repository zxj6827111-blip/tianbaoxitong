const normalizeText = (input) => {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[“”"'`]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[,:;，。；：、]/g, '')
    .replace(/[\s\r\n\t]+/g, '')
    .replace(/万元|万|元/g, '');
};

const EXACT_ALIAS_MAP = new Map([
  ['收入合计', 'budget_revenue_total'],
  ['收入总计', 'budget_revenue_total'],
  ['本年收入', 'budget_revenue_total'],
  ['预算收入合计', 'budget_revenue_total'],
  ['财政拨款收入', 'budget_revenue_fiscal'],
  ['事业收入', 'budget_revenue_business'],
  ['事业单位经营收入', 'budget_revenue_operation'],
  ['经营收入', 'budget_revenue_operation'],
  ['其他收入', 'budget_revenue_other'],

  ['支出合计', 'budget_expenditure_total'],
  ['支出总计', 'budget_expenditure_total'],
  ['本年支出', 'budget_expenditure_total'],
  ['预算支出合计', 'budget_expenditure_total'],
  ['基本支出', 'budget_expenditure_basic'],
  ['项目支出', 'budget_expenditure_project'],

  ['财政拨款收入合计', 'fiscal_grant_revenue_total'],
  ['财政拨款支出合计', 'fiscal_grant_expenditure_total'],
  ['一般公共预算财政拨款支出', 'fiscal_grant_expenditure_general'],
  ['政府性基金预算财政拨款支出', 'fiscal_grant_expenditure_gov_fund'],
  ['国有资本经营预算财政拨款支出', 'fiscal_grant_expenditure_capital'],

  ['三公经费合计', 'three_public_total'],
  ['三公经费', 'three_public_total'],
  ['因公出国费', 'three_public_outbound'],
  ['因公出国境费', 'three_public_outbound'],
  ['公务用车购置及运行费', 'three_public_vehicle_total'],
  ['公务用车购置和运行费', 'three_public_vehicle_total'],
  ['公务用车购置费', 'three_public_vehicle_purchase'],
  ['公务用车运行费', 'three_public_vehicle_operation'],
  ['公务接待费', 'three_public_reception'],
  ['机关运行经费预算数', 'operation_fund'],
  ['机关运行经费', 'operation_fund'],

  ['totalincome', 'budget_revenue_total'],
  ['fiscalappropriationincome', 'budget_revenue_fiscal'],
  ['businessincome', 'budget_revenue_business'],
  ['operationincome', 'budget_revenue_operation'],
  ['otherincome', 'budget_revenue_other'],
  ['totalexpenditure', 'budget_expenditure_total'],
  ['basicexpenditure', 'budget_expenditure_basic'],
  ['projectexpenditure', 'budget_expenditure_project'],
  ['threepublictotal', 'three_public_total'],
  ['outboundexpense', 'three_public_outbound'],
  ['vehiclepurchaseoperation', 'three_public_vehicle_total'],
  ['vehiclepurchase', 'three_public_vehicle_purchase'],
  ['vehicleoperation', 'three_public_vehicle_operation'],
  ['receptionexpense', 'three_public_reception'],
  ['operationfund', 'operation_fund']
]);

const FUZZY_RULES = [
  { key: 'three_public_total', test: (text) => text.includes('三公') && text.includes('合计') },
  { key: 'three_public_outbound', test: (text) => text.includes('因公出国') },
  { key: 'three_public_vehicle_total', test: (text) => text.includes('公务用车') && (text.includes('购置及运行') || text.includes('购置和运行')) },
  { key: 'three_public_vehicle_purchase', test: (text) => text.includes('公务用车') && text.includes('购置费') && !text.includes('运行') },
  { key: 'three_public_vehicle_operation', test: (text) => text.includes('公务用车') && text.includes('运行费') },
  { key: 'three_public_reception', test: (text) => text.includes('公务接待') },
  { key: 'operation_fund', test: (text) => text.includes('机关运行经费') },

  { key: 'fiscal_grant_expenditure_capital', test: (text) => text.includes('国有资本经营预算') && text.includes('财政拨款') && text.includes('支出') },
  { key: 'fiscal_grant_expenditure_gov_fund', test: (text) => text.includes('政府性基金预算') && text.includes('财政拨款') && text.includes('支出') },
  { key: 'fiscal_grant_expenditure_general', test: (text) => text.includes('一般公共预算') && text.includes('财政拨款') && text.includes('支出') },
  { key: 'fiscal_grant_expenditure_total', test: (text) => text.includes('财政拨款') && text.includes('支出') && text.includes('合计') },
  { key: 'fiscal_grant_revenue_total', test: (text) => text.includes('财政拨款') && text.includes('收入') && text.includes('合计') },

  { key: 'budget_expenditure_project', test: (text) => text.includes('项目支出') },
  { key: 'budget_expenditure_basic', test: (text) => text.includes('基本支出') },
  { key: 'budget_expenditure_total', test: (text) => text.includes('支出') && (text.includes('总计') || text.includes('合计') || text.includes('本年支出')) },

  { key: 'budget_revenue_fiscal', test: (text) => text.includes('财政拨款收入') },
  { key: 'budget_revenue_business', test: (text) => text.includes('事业收入') },
  { key: 'budget_revenue_operation', test: (text) => text.includes('经营收入') },
  { key: 'budget_revenue_other', test: (text) => text.includes('其他收入') },
  { key: 'budget_revenue_total', test: (text) => text.includes('收入') && (text.includes('总计') || text.includes('合计') || text.includes('本年收入')) }
];

const resolveHistoryActualKey = (rawLabel) => {
  const normalized = normalizeText(rawLabel);
  if (!normalized) return null;

  if (EXACT_ALIAS_MAP.has(normalized)) {
    return EXACT_ALIAS_MAP.get(normalized);
  }

  const matched = FUZZY_RULES.find((rule) => rule.test(normalized));
  return matched ? matched.key : null;
};

module.exports = {
  normalizeText,
  resolveHistoryActualKey
};
