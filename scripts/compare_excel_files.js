const XLSX = require('xlsx');
const path = require('path');

console.log('='.repeat(80));
console.log('Excel 文件对比分析');
console.log('='.repeat(80));
console.log('');

// 模板文件
const templatePath = path.join(__dirname, '../X/区级模版/附件2：2026年单位预算公开样张（区级）.xls');
// 实际数据文件
const dataPath = path.join(__dirname, '../X/民政及万里两年预算表/民政局下各单位2024年人大预算表/002003-上海市普陀区社会福利院-人代会报表制作.xlsx');

console.log('模板文件:', templatePath);
console.log('数据文件:', dataPath);
console.log('');

// 读取模板文件
console.log('【1】读取模板文件...');
const templateWorkbook = XLSX.readFile(templatePath);
const templateSheets = Object.keys(templateWorkbook.Sheets);
console.log(`   包含 ${templateSheets.length} 个工作表：`);
templateSheets.forEach((name, index) => {
    console.log(`   ${index + 1}. "${name}"`);
});
console.log('');

// 读取数据文件
console.log('【2】读取数据文件...');
const dataWorkbook = XLSX.readFile(dataPath);
const dataSheets = Object.keys(dataWorkbook.Sheets);
console.log(`   包含 ${dataSheets.length} 个工作表：`);
dataSheets.forEach((name, index) => {
    console.log(`   ${index + 1}. "${name}"`);
});
console.log('');

// 对比工作表
console.log('【3】对比分析...');
console.log('');

// 查找共同的工作表
const commonSheets = templateSheets.filter(sheet => dataSheets.includes(sheet));
console.log(`✓ 共同工作表 (${commonSheets.length} 个):`);
if (commonSheets.length > 0) {
    commonSheets.forEach(name => console.log(`   - "${name}"`));
} else {
    console.log('   无');
}
console.log('');

// 只在模板中的工作表
const onlyInTemplate = templateSheets.filter(sheet => !dataSheets.includes(sheet));
console.log(`⚠ 只在模板中的工作表 (${onlyInTemplate.length} 个):`);
if (onlyInTemplate.length > 0) {
    onlyInTemplate.forEach(name => console.log(`   - "${name}"`));
} else {
    console.log('   无');
}
console.log('');

// 只在数据文件中的工作表
const onlyInData = dataSheets.filter(sheet => !templateSheets.includes(sheet));
console.log(`⚠ 只在数据文件中的工作表 (${onlyInData.length} 个):`);
if (onlyInData.length > 0) {
    onlyInData.forEach(name => console.log(`   - "${name}"`));
} else {
    console.log('   无');
}
console.log('');

// 检查系统需要的工作表
console.log('【4】检查系统配置所需的工作表...');
const requiredSheets = ['预算汇总', '财政拨款收支总表'];
console.log('   系统需要的工作表：');
requiredSheets.forEach(name => console.log(`   - "${name}"`));
console.log('');

const templateHasRequired = requiredSheets.filter(sheet => templateSheets.includes(sheet));
const dataHasRequired = requiredSheets.filter(sheet => dataSheets.includes(sheet));

console.log(`   模板文件包含: ${templateHasRequired.length}/${requiredSheets.length}`);
templateHasRequired.forEach(name => console.log(`     ✓ "${name}"`));
requiredSheets.filter(s => !templateHasRequired.includes(s)).forEach(name => console.log(`     ✗ "${name}"`));

console.log('');
console.log(`   数据文件包含: ${dataHasRequired.length}/${requiredSheets.length}`);
dataHasRequired.forEach(name => console.log(`     ✓ "${name}"`));
requiredSheets.filter(s => !dataHasRequired.includes(s)).forEach(name => console.log(`     ✗ "${name}"`));

console.log('');
console.log('【5】结论...');
if (templateHasRequired.length === requiredSheets.length && dataHasRequired.length === requiredSheets.length) {
    console.log('   ✓ 两个文件都包含系统所需的工作表，可以正常使用');
} else if (templateHasRequired.length === requiredSheets.length) {
    console.log('   ⚠ 模板文件符合要求，但数据文件缺少必需的工作表');
    console.log('   → 建议：数据文件应该按照模板文件的结构填写');
} else if (dataHasRequired.length === requiredSheets.length) {
    console.log('   ⚠ 数据文件符合要求，但模板文件缺少必需的工作表');
    console.log('   → 可能模板文件不是正确的模板');
} else {
    console.log('   ✗ 两个文件都不包含系统所需的工作表');
    console.log('   → 建议：需要重新配置系统的 budgetMapping.js 文件以适配当前文件格式');
    console.log('          或者使用包含"预算汇总"和"财政拨款收支总表"的文件');
}

console.log('');
console.log('='.repeat(80));
