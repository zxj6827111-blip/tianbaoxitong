const XLSX = require('xlsx');
const path = require('path');

const filePath = path.resolve('d:\\软件开发\\谷歌反重力开发\\tianbaoxitong\\tianbaoxitong\\X\\民政及万里两年预算表\\民政局下各单位2025年人大预算表\\002003-上海市普陀区社会福利院-人代会报表制作.xlsx');

const workbook = XLSX.readFile(filePath);

console.log('Searching for "类" "款" "项" headers...');

workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet['!ref']) return;

    const range = XLSX.utils.decode_range(sheet['!ref']);
    let found = false;

    // Scan first 10 rows
    for (let R = range.s.r; R <= Math.min(range.e.r, 10); ++R) {
        let rowText = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = sheet[XLSX.utils.encode_cell({ c: C, r: R })];
            if (cell && cell.v) {
                const val = String(cell.v).trim();
                if (val === '类' || val === '款' || val === '项' || val.includes('功能分类科目')) {
                    found = true;
                }
                rowText.push(val);
            }
        }
        if (found) {
            console.log(`[FOUND in ${sheetName}]: Row ${R + 1}: ${rowText.join(' | ')}`);
            break; // Found header in this sheet
        }
    }
});
