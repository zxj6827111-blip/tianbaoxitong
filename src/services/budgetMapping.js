const BUDGET_MAPPING = [
  // === 预算汇总 / 2.15单位收支总表 (收入) ===
  {
    key: 'budget_revenue_total',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '收入合计',
    rowAnchorAliases: ['收入总计'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数']
  },
  {
    key: 'budget_revenue_fiscal',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '其中：财政拨款收入',
    rowAnchorAliases: ['一、财政拨款收入', '财政拨款收入'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数']
  },
  {
    key: 'budget_revenue_business',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '事业收入',
    rowAnchorAliases: ['二、事业收入'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数']
  },
  {
    key: 'budget_revenue_operation',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '事业单位经营收入',
    rowAnchorAliases: ['三、事业单位经营收入'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数'],
    optional: true
  },
  {
    key: 'budget_revenue_other',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '其他收入',
    rowAnchorAliases: ['四、其他收入'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数']
  },

  // === 预算汇总 / 2.15单位收支总表 (支出) ===
  {
    key: 'budget_expenditure_total',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '支出合计',
    rowAnchorAliases: ['支出总计'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数', '合计'],
    sumCols: ['人员经费', '公用经费', '项目支出']
  },
  {
    key: 'budget_expenditure_basic',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '基本支出',
    rowAnchorAliases: ['支出总计', '支出合计'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数', '基本支出'],
    sumCols: ['人员经费', '公用经费']
  },
  {
    key: 'budget_expenditure_project',
    sheet: '预算汇总',
    aliases: ['2.15单位收支总表'],
    rowAnchor: '项目支出',
    rowAnchorAliases: ['支出总计', '支出合计'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数', '项目支出']
  },

  // === 财政拨款收支总表 / 2.18单位财政拨款收支总表 ===
  {
    key: 'fiscal_grant_revenue_total',
    sheet: '财政拨款收支总表',
    aliases: ['2.18单位财政拨款收支总表'],
    rowAnchor: '拨款收入合计',
    rowAnchorAliases: ['收入总计'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['预算数'],
    sumRows: ['一、一般公共预算资金', '二、政府性基金', '三、国有资本经营预算']
  },
  {
    key: 'fiscal_grant_expenditure_total',
    sheet: '财政拨款收支总表',
    aliases: ['2.18单位财政拨款收支总表'],
    rowAnchor: '拨款支出合计',
    rowAnchorAliases: ['支出总计'],
    colAnchor: '预算数（万元）',
    colAnchorAliases: ['一般公共预算', '预算数'],
    sumRows: [
      '一、一般公共服务支出',
      '二、公共安全支出',
      '三、教育支出',
      '四、科学技术支出',
      '五、文化旅游体育与传媒支出',
      '六、社会保障和就业支出',
      '七、卫生健康支出',
      '八、城乡社区支出',
      '九、住房保障支出'
    ]
  },
  {
    key: 'fiscal_grant_expenditure_general',
    sheet: '财政拨款收支总表',
    aliases: ['2.18单位财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorAliases: ['拨款支出合计'],
    colAnchor: '一般公共预算',
    colAnchorAliases: ['预算数（万元）', '预算数'],
    optional: true
  },
  {
    key: 'fiscal_grant_expenditure_gov_fund',
    sheet: '财政拨款收支总表',
    aliases: ['2.18单位财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorAliases: ['拨款支出合计'],
    colAnchor: '政府性基金',
    optional: true
  },
  {
    key: 'fiscal_grant_expenditure_capital',
    sheet: '财政拨款收支总表',
    aliases: ['2.18单位财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorAliases: ['拨款支出合计'],
    colAnchor: '国有资本经营预算',
    optional: true
  },

  // === 2.25单位“三公”经费和机关运行费预算表 ===
  {
    key: 'three_public_total',
    sheet: '2.25单位“三公”经费和机关运行费预算表',
    rowAnchor: '“三公”经费合计',
    rowAnchorAliases: ['三公经费合计', '三公经费'],
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_outbound',
    sheet: '2.25单位“三公”经费和机关运行费预算表',
    rowAnchor: '因公出国（境）费',
    rowAnchorAliases: ['因公出国费', '因公出国(境)费'],
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_vehicle_total',
    sheet: '2.25单位“三公”经费和机关运行费预算表',
    rowAnchor: '公务用车购置及运行费',
    rowAnchorAliases: ['公务用车购置和运行费'],
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_vehicle_purchase',
    sheet: '2.25单位“三公”经费和机关运行费预算表',
    rowAnchor: '公务用车购置费',
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_vehicle_operation',
    sheet: '2.25单位“三公”经费和机关运行费预算表',
    rowAnchor: '公务用车运行费',
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_reception',
    sheet: '2.25单位“三公”经费和机关运行费预算表',
    rowAnchor: '公务接待费',
    colAnchor: '预算数',
    optional: true
  },

  // === 文本内容提取 ===
  {
    key: 'main_functions',
    sheet: '2.11单位职能（单位）',
    type: 'text',
    strategy: 'all_content'
  },
  {
    key: 'organizational_structure',
    sheet: '2.12单位机构设置（单位）',
    type: 'text',
    strategy: 'all_content'
  },
  {
    key: 'glossary',
    sheet: '2.13名词解释（单位）',
    type: 'text',
    strategy: 'all_content'
  },
  {
    key: 'unit_full_name',
    sheet: '2.11单位职能（单位）',
    type: 'text',
    strategy: 'first_cell'
  }
];

const BUDGET_MAPPING_DEPARTMENT = [
  // === 1.3部门财务收支总表 (收入) ===
  {
    key: 'budget_revenue_total',
    sheet: '1.3部门财务收支总表',
    aliases: ['3.15部门收支总表'],
    rowAnchor: '本年收入',
    colAnchor: '预算数',
    colAnchorIndex: 1,
    sumRows: ['一、财政拨款收入', '二、事业收入', '三、事业单位经营收入', '四、其他收入']
  },
  {
    key: 'budget_revenue_fiscal',
    sheet: '1.3部门财务收支总表',
    aliases: ['3.15部门收支总表'],
    rowAnchor: '一、财政拨款收入',
    colAnchor: '预算数',
    colAnchorIndex: 1
  },
  {
    key: 'budget_revenue_business',
    sheet: '1.3部门财务收支总表',
    aliases: ['3.15部门收支总表'],
    rowAnchor: '二、事业收入',
    colAnchor: '预算数',
    colAnchorIndex: 1
  },
  {
    key: 'budget_revenue_operation',
    sheet: '1.3部门财务收支总表',
    aliases: ['3.15部门收支总表'],
    rowAnchor: '三、事业单位经营收入',
    colAnchor: '预算数',
    colAnchorIndex: 1,
    optional: true
  },
  {
    key: 'budget_revenue_other',
    sheet: '1.3部门财务收支总表',
    aliases: ['3.15部门收支总表'],
    rowAnchor: '四、其他收入',
    colAnchor: '预算数',
    colAnchorIndex: 1,
    optional: true
  },

  // === 1.3部门财务收支总表 (支出) ===
  {
    key: 'budget_expenditure_total',
    sheet: '1.3部门财务收支总表',
    aliases: ['3.15部门收支总表'],
    rowAnchor: '本年支出',
    colAnchor: '预算数',
    colAnchorIndex: 2,
    sumRows: [
      '一、一般公共服务支出',
      '二、公共安全支出',
      '三、教育支出',
      '四、科学技术支出',
      '五、文化旅游体育与传媒支出',
      '六、社会保障和就业支出',
      '七、卫生健康支出',
      '八、城乡社区支出',
      '九、住房保障支出'
    ]
  },

  // === 1.4财政拨款支出预算表 (基本/项目 -> 3.20) ===
  {
    key: 'budget_expenditure_basic',
    sheet: '1.4财政拨款支出预算表',
    aliases: ['3.20部门财政拨款支出预算明细表'],
    rowAnchor: '合计',
    rowAnchorIndex: -1,
    colAnchor: '基本支出'
  },
  {
    key: 'budget_expenditure_project',
    sheet: '1.4财政拨款支出预算表',
    aliases: ['3.20部门财政拨款支出预算明细表'],
    rowAnchor: '合计',
    rowAnchorIndex: -1,
    colAnchor: '项目支出'
  },
  // === 1.4财政拨款支出预算表 (Summary -> 3.19) ===
  {
    key: 'fiscal_grant_revenue_total',
    sheet: '1.3部门财务收支总表', // Note: This key was on 1.3 in original? Wait. Line 199 says '1.3'.
    aliases: ['3.19部门财政拨款收支总表'],
    rowAnchor: '一、财政拨款收入',
    rowAnchorAliases: ['财政拨款收入'], // 3.19 has '财政拨款收入' in header, but data? 3.19 has '一、一般公共...' under '财政拨款收入' column? No.
    // 3.19 Row 9: "一、一般公共预算资金" UNDER "财政拨款收入" (Col 0)?
    // Inspect 3.19 output: Row 9: ["一、一般公共预算资金", 156211123, ...]. Yes.
    // But original rule was on '1.3'. Why? "fiscal_grant_revenue_total".
    // 1.3 has "一、财政拨款收入".
    // 3.15 has "一、财政拨款收入" (Row 7).
    // So this rule should map to 3.15 (1.3 alias), NOT 3.19.
    // Wait, line 199 says sheet: '1.3部门财务收支总表'.
    // So aliases should be ['3.15部门收支总表'].
    // My plan said 3.19... but if 1.3 works (3.15), use it.
    // 3.15 Row 7: ["一、财政拨款收入", 156211123]. Correct.
    aliases: ['3.15部门收支总表'],
    colAnchor: '预算数',
    colAnchorIndex: 1,
    sumRows: ['1. 一般公共预算资金', '2. 政府性基金', '3. 国有资本经营预算'] // 3.15 Row 8 has "1. 一般...".
  },
  {
    key: 'fiscal_grant_expenditure_total',
    sheet: '1.4财政拨款支出预算表',
    aliases: ['3.19部门财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorIndex: -1,
    rowAnchorAliases: ['合计'],
    colAnchor: '一般公共预算',
    colAnchorAliases: ['合计'],
    sumRows: [
      '一、一般公共服务支出',
      '二、公共安全支出',
      '三、教育支出',
      '四、科学技术支出',
      '五、文化旅游体育与传媒支出',
      '六、社会保障和就业支出',
      '七、卫生健康支出',
      '八、城乡社区支出',
      '九、住房保障支出'
    ]
  },
  {
    key: 'fiscal_grant_expenditure_general',
    sheet: '1.4财政拨款支出预算表',
    aliases: ['3.19部门财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorIndex: -1,
    rowAnchorAliases: ['合计'],
    colAnchor: '一般公共预算',
    colAnchorAliases: ['合计']
  },
  {
    key: 'fiscal_grant_expenditure_gov_fund',
    sheet: '1.4财政拨款支出预算表',
    aliases: ['3.19部门财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorIndex: -1,
    rowAnchorAliases: ['合计'],
    colAnchor: '政府性基金',
    colAnchorAliases: ['政府性基金预算'],
    optional: true
  },
  {
    key: 'fiscal_grant_expenditure_capital',
    sheet: '1.4财政拨款支出预算表',
    aliases: ['3.19部门财政拨款收支总表'],
    rowAnchor: '支出总计',
    rowAnchorIndex: -1,
    rowAnchorAliases: ['合计'],
    colAnchor: '国有资本经营预算',
    optional: true
  },

  // === 3.25部门“三公”经费和机关运行经费预算表 ===
  {
    key: 'three_public_total',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '“三公”经费合计',
    rowAnchorAliases: ['三公经费合计', '三公经费'],
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_total',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '合计',
    rowOffset: 2,
    colAnchor: '合计', // A列
    optional: true
  },
  {
    key: 'three_public_outbound',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '因公出国（境）费',
    rowAnchorAliases: ['因公出国费', '因公出国(境)费'],
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_outbound',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '合计',
    rowOffset: 2,
    colAnchor: '因公出国(境)费', // B列
    optional: true
  },
  {
    key: 'three_public_vehicle_total',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '公务用车购置及运行费',
    rowAnchorAliases: ['公务用车购置和运行费'],
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_vehicle_total',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '合计',
    rowOffset: 2,
    colAnchor: '小计', // 车购运行费下的小计, 对应 Three public vehicle total
    // 截图显示: 公务用车购置及运行费 (Merged) -> 下一行: 小计 | 购置费 | 运行费
    // 我们需要 total。小计是 Total 吗? 是的.
    // Anchor '小计' 肯定在 Header 行。
    // 但是 '小计' 可能不唯一? 截图里只有这一个小计。
    optional: true
  },
  {
    key: 'three_public_vehicle_purchase',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '公务用车购置费',
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_vehicle_purchase',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '合计',
    rowOffset: 2,
    colAnchor: '购置费',
    optional: true
  },
  {
    key: 'three_public_vehicle_operation',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '公务用车运行费',
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_vehicle_operation',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '合计',
    rowOffset: 2,
    colAnchor: '运行费',
    optional: true
  },
  {
    key: 'three_public_reception',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '公务接待费',
    colAnchor: '预算数',
    optional: true
  },
  {
    key: 'three_public_reception',
    sheet: '1.9部门“三公”经费和机关运行经费预算表',
    aliases: ['3.25部门“三公”经费和机关运行经费预算表'],
    rowAnchor: '合计',
    rowOffset: 2,
    colAnchor: '公务接待费', // 截图显示 Header 里有
    optional: true
  },

  // === 文本内容提取（部门口径） ===
  {
    key: 'main_functions',
    sheet: '3.11部门主要职能（部门）',
    type: 'text',
    strategy: 'all_content'
  },
  {
    key: 'organizational_structure',
    sheet: '3.12部门机构设置（部门）',
    type: 'text',
    strategy: 'all_content'
  },
  {
    key: 'glossary',
    sheet: '3.13名词解释（部门）',
    type: 'text',
    strategy: 'all_content'
  },
  {
    key: 'unit_full_name',
    sheet: '3.11部门主要职能（部门）',
    type: 'text',
    strategy: 'first_cell'
  }
];

module.exports = {
  BUDGET_MAPPING,
  BUDGET_MAPPING_DEPARTMENT
};
