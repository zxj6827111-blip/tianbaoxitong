const { extractHistoryFactsFromTableData } = require('../src/services/historyFactAutoExtractor');

describe('historyFactAutoExtractor', () => {
  it('extracts yuan-based summary tables into wanyuan even when table_key is unknown', () => {
    const budgetRows = [
      ['2025年部门财务收支预算总表'],
      ['编制部门：上海市普陀区人民政府万里街道办事处', '单位：元'],
      ['本年收入', '本年支出'],
      ['项目', '预算数', '项目', '预算数'],
      ['一、财政拨款收入', '189,767,551', '一、一般公共服务支出', '3,296,600'],
      ['收入总计', '189,767,551', '支出总计', '189,767,551']
    ];

    const fiscalRows = [
      ['2025年部门财政拨款收支预算总表'],
      ['编制部门：上海市普陀区人民政府万里街道办事处', '单位：元'],
      ['收入总计', '189,767,551', '支出总计', '189,767,551', '189,767,551', '0', '0']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'unknown_page_1', data_json: budgetRows },
      { table_key: 'unknown_page_2', data_json: fiscalRows }
    ]);

    expect(facts.budget_revenue_total).toBe(18976.76);
    expect(facts.budget_expenditure_total).toBe(18976.76);
    expect(facts.fiscal_grant_revenue_total).toBe(18976.76);
    expect(facts.fiscal_grant_expenditure_total).toBe(18976.76);
  });

  it('infers yuan scale when unit line is missing but values are large', () => {
    const budgetRows = [
      ['本年收入', '本年支出'],
      ['项目', '预算数', '项目', '预算数'],
      ['一、财政拨款收入', '189,767,551', '一、一般公共服务支出', '3,296,600'],
      ['收入总计', '189,767,551', '支出总计', '189,767,551']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'budget_summary', data_json: budgetRows }
    ]);

    expect(facts.budget_revenue_total).toBe(18976.76);
    expect(facts.budget_expenditure_total).toBe(18976.76);
  });

  it('keeps three-public table values in wanyuan', () => {
    const threeRows = [
      ['2025年部门“三公”经费和机关运行经费预算表'],
      ['编制部门：上海市普陀区人民政府万里街道办事处', '单位:万元'],
      ['合计', '因公出国(境)费', '公务接待费', '公务用车购置及运行费', '购置费', '运行费'],
      ['37.91', '0', '1.35', '36.56', '15', '21.56', '464.64']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'three_public', data_json: threeRows }
    ]);

    expect(facts.three_public_total).toBe(37.91);
    expect(facts.three_public_reception).toBe(1.35);
    expect(facts.three_public_vehicle_operation).toBe(21.56);
    expect(facts.operation_fund).toBe(464.64);
  });

  it('defaults income_summary to yuan when unit row is missing', () => {
    const incomeRows = [
      ['项目', '收入预算'],
      ['功能分类科目名称', '合计', '财政拨款收入', '事业收入', '事业单位经营收入', '其他收入'],
      ['类', '款', '项'],
      ['201', '一般公共服务支出', '5000', '5000', '0', '0', '0']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'income_summary', data_json: incomeRows }
    ]);

    expect(facts.budget_revenue_total).toBe(0.5);
    expect(facts.budget_revenue_fiscal).toBe(0.5);
  });

  it('defaults three_public to wanyuan when unit row is missing', () => {
    const threeRows = [
      ['2025年部门“三公”经费和机关运行经费预算表'],
      ['合计', '因公出国(境)费', '公务接待费', '公务用车购置及运行费', '购置费', '运行费'],
      ['37.91', '0', '1.35', '36.56', '15', '21.56']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'three_public', data_json: threeRows }
    ]);

    expect(facts.three_public_total).toBe(37.91);
    expect(facts.three_public_reception).toBe(1.35);
    expect(facts.three_public_vehicle_operation).toBe(21.56);
  });

  it('extracts sparse three-public rows with operation fund column', () => {
    const threeRows = [
      ['编制部门：上海市普陀区财政局', '单位:万元'],
      ['合计', '因公出国(境)费', '公务接待费'],
      ['小计', '购置费', '运行费'],
      ['0.95', '0.95', '229.43']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'three_public', data_json: threeRows }
    ]);

    expect(facts.three_public_total).toBe(0.95);
    expect(facts.three_public_reception).toBe(0.95);
    expect(facts.operation_fund).toBe(229.43);
  });

  it('extracts operation fund and preserves column positions in sparse three-public layout', () => {
    const threeRows = [
      ['\u7f16\u5236\u90e8\u95e8\uff1a\u4e0a\u6d77\u5e02\u666e\u9640\u533a\u4eba\u6c11\u653f\u5e9c\u529e\u516c\u5ba4', '\u5355\u4f4d:\u4e07\u5143', '', ''],
      ['\u201c\u4e09\u516c\u201d\u7ecf\u8d39\u9884\u7b97\u6570', '', '', ''],
      ['\u673a\u5173\u8fd0\u884c\u7ecf\u8d39\u9884\u7b97', '', '', ''],
      ['\u6570', '', '', ''],
      ['\u5408\u8ba1', '\u56e0\u516c\u51fa\u56fd(\u5883)\u8d39', '\u516c\u52a1\u63a5\u5f85\u8d39', ''],
      ['\u516c\u52a1\u7528\u8f66\u8d2d\u7f6e\u53ca\u8fd0\u884c\u8d39', '', '', ''],
      ['\u5c0f\u8ba1', '\u8d2d\u7f6e\u8d39', '\u8fd0\u884c\u8d39', ''],
      ['867.50', '839.00', '28.50', '', '', '', '213.28']
    ];

    const facts = extractHistoryFactsFromTableData([
      { table_key: 'three_public', data_json: threeRows }
    ]);

    expect(facts.three_public_total).toBe(867.5);
    expect(facts.three_public_outbound).toBe(839);
    expect(facts.three_public_reception).toBe(28.5);
    expect(facts.three_public_vehicle_total).toBe(0);
    expect(facts.operation_fund).toBe(213.28);
  });
});
