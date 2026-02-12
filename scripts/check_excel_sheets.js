const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Find the most recent upload file
const uploadsDir = path.join(__dirname, '../storage/uploads');

if (!fs.existsSync(uploadsDir)) {
    console.log('Uploads directory does not exist');
    process.exit(1);
}

const files = fs.readdirSync(uploadsDir);
const xlsxFiles = files.filter(f => f.endsWith('.xlsx'));

if (xlsxFiles.length === 0) {
    console.log('No Excel files found in uploads directory');
    process.exit(1);
}

// Get the most recent file
const latestFile = xlsxFiles
    .map(f => ({
        name: f,
        path: path.join(uploadsDir, f),
        mtime: fs.statSync(path.join(uploadsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime)[0];

console.log('=== 检查最新上传的Excel文件 ===');
console.log('文件名:', latestFile.name);
console.log('上传时间:', latestFile.mtime);
console.log('');

// Read the file
const workbook = XLSX.readFile(latestFile.path);

console.log('=== 文件中包含的工作表 ===');
const sheetNames = Object.keys(workbook.Sheets);
sheetNames.forEach((name, index) => {
    console.log(`${index + 1}. "${name}"`);
});

console.log('');
console.log('=== 系统需要的工作表 ===');
console.log('1. "预算汇总"');
console.log('2. "财政拨款收支总表"');

console.log('');
console.log('=== 检查结果 ===');
const has预算汇总 = sheetNames.includes('预算汇总');
const has财政拨款 = sheetNames.includes('财政拨款收支总表');

console.log(has预算汇总 ? '✓ 找到"预算汇总"' : '✗ 缺少"预算汇总"');
console.log(has财政拨款 ? '✓ 找到"财政拨款收支总表"' : '✗ 缺少"财政拨款收支总表"');

if (!has预算汇总 || !has财政拨款) {
    console.log('');
    console.log('⚠️  工作表名称不匹配！');
    console.log('请检查Excel文件中的工作表标签名称是否与系统要求完全一致（包括空格、标点符号）');
}
