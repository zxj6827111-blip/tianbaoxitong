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
});
