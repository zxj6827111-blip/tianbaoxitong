/**
 * 测试修复: 机关运行经费 + 基本支出/项目支出 提取增强
 */

const { extractHistoryFactsFromTableData } = require('../src/services/historyFactAutoExtractor');

console.log('=== 测试1: 基本支出/项目支出从预算汇总表提取 ===\n');

const budgetSummaryData = [
    {
        table_key: 'budget_summary',
        data_json: [
            ['项目', '收入', '项目(支出)', '支出'],
            ['单位:元', '', '', ''],
            ['收入总计', '189767600', '', ''],
            ['财政拨款收入', '189767600', '', ''],
            ['事业收入', '0', '', ''],
            ['其他收入', '0', '', ''],
            ['', '', '支出总计', '189767600'],
            ['', '', '基本支出', '186471000'],
            ['', '', '项目支出', '3296600'],
        ]
    }
];

const result1 = extractHistoryFactsFromTableData(budgetSummaryData);
console.log('提取结果:');
console.log('- budget_expenditure_total:', result1.budget_expenditure_total, '万元');
console.log('- budget_expenditure_basic:', result1.budget_expenditure_basic, '万元');
console.log('- budget_expenditure_project:', result1.budget_expenditure_project, '万元');
if (result1.budget_expenditure_basic !== undefined && result1.budget_expenditure_basic !== null) {
    const sum = (result1.budget_expenditure_basic || 0) + (result1.budget_expenditure_project || 0);
    console.log('- basic + project =', sum.toFixed(2), '万元');
    console.log('- 平衡检查:', Math.abs(result1.budget_expenditure_total - sum) <= 0.01 ? '✅ 通过' : '❌ 不通过');
} else {
    console.log('❌ 基本支出未提取');
}

console.log('\n=== 测试2: 6个数值 + 独立机关运行经费行 ===\n');

const threePublicData = [
    {
        table_key: 'three_public',
        data_json: [
            ['项目', '2025年预算数'],
            ['单位:万元', ''],
            ['"三公"经费合计', '37.91'],
            ['1.因公出国(境)费', '0.00'],
            ['2.公务接待费', '1.35'],
            ['3.公务用车购置及运行费', '36.56'],
            ['其中:公务用车购置费', '15.00'],
            ['公务用车运行费', '21.56'],
            ['机关运行经费预算数(万元)', '0.00'],
            ['', '37.91', '0.00', '1.35', '36.56', '15.00', '21.56']
        ]
    }
];

const result2 = extractHistoryFactsFromTableData(threePublicData);
console.log('- three_public_total:', result2.three_public_total);
console.log('- operation_fund:', result2.operation_fund, result2.operation_fund !== null && result2.operation_fund !== undefined ? '✅ 已提取' : '❌ 未提取');

console.log('\n=== 测试3: 完整数据模拟 ===\n');

const fullData = [
    ...budgetSummaryData,
    ...threePublicData
];

const result3 = extractHistoryFactsFromTableData(fullData);
console.log('完整提取:');
Object.entries(result3).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
});

// 验证平衡
const total = result3.budget_expenditure_total;
const basic = result3.budget_expenditure_basic;
const project = result3.budget_expenditure_project;
if (total !== null && basic !== null && project !== null) {
    const sum = basic + project;
    const diff = Math.abs(total - sum);
    console.log(`\n平衡验证: ${total} vs ${basic} + ${project} = ${sum.toFixed(2)}, 差额=${diff.toFixed(2)}`);
    console.log(diff <= 0.01 ? '✅ 平衡检查通过!' : `❌ 平衡检查失败! 差额=${diff.toFixed(2)}`);
} else {
    console.log('\n❌ 缺少必要的支出字段,无法平衡验证');
}

console.log('\n=== 测试完成 ===');
