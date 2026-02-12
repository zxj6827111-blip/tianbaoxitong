const xlsx = require('xlsx');
const fs = require('fs');

const filePath = String.raw`d:\软件开发\谷歌反重力开发\tianbaoxitong\tianbaoxitong\X\民政及万里两年预算表\万里街道部门2024年预算表（查询表+草案表）\026\026上海市普陀区人民政府万里街道办事处\上海市普陀区人民政府万里街道办事处.xlsx`;

const sheetsToInspect = [
    '3.15部门收支总表',
    '3.19部门财政拨款收支总表',
    '3.20部门财政拨款支出预算明细表',
    '3.21部门一般公共预算支出功能分类预算表'
];

try {
    const workbook = xlsx.readFile(filePath);

    sheetsToInspect.forEach(sheetName => {
        if (workbook.Sheets[sheetName]) {
            console.log(`\n--- Content of ${sheetName} ---`);
            const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }).slice(0, 20); // First 20 rows
            data.forEach((row, i) => console.log(`Row ${i}:`, JSON.stringify(row)));
        } else {
            console.log(`\n--- Sheet ${sheetName} NOT FOUND ---`);
        }
    });

} catch (error) {
    console.error('Error reading file:', error);
}
