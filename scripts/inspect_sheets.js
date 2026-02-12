const xlsx = require('xlsx');
const fs = require('fs');

const filePath = String.raw`d:\软件开发\谷歌反重力开发\tianbaoxitong\tianbaoxitong\X\民政及万里两年预算表\万里街道部门2024年预算表（查询表+草案表）\026\026上海市普陀区人民政府万里街道办事处\上海市普陀区人民政府万里街道办事处.xlsx`;

try {
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    const workbook = xlsx.readFile(filePath);
    console.log('Sheets found in file:');
    workbook.SheetNames.forEach((name, index) => {
        console.log(`${index + 1}: ${name}`);
    });
} catch (error) {
    console.error('Error reading file:', error);
}
