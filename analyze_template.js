const XLSX = require('xlsx');
const path = require('path');

const filePath = path.resolve('d:\\软件开发\\谷歌反重力开发\\tianbaoxitong\\tianbaoxitong\\X\\区级模版\\附件2：2026年单位预算公开样张（区级）.xls');

console.log(`Analyzing file: ${filePath}`);

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet Names:', workbook.SheetNames);

    workbook.SheetNames.forEach(sheetName => {
        console.log(`\n--- Sheet: ${sheetName} ---`);
        const sheet = workbook.Sheets[sheetName];
        if (!sheet['!ref']) {
            console.log('Empty sheet');
            return;
        }
        const range = XLSX.utils.decode_range(sheet['!ref']);

        // Check first 20 rows
        for (let R = range.s.r; R <= Math.min(range.e.r, 20); ++R) {
            let rowContent = [];
            for (let C = range.s.c; C <= 8; ++C) { // First 8 columns
                const cellAddress = { c: C, r: R };
                const cellRef = XLSX.utils.encode_cell(cellAddress);
                const cell = sheet[cellRef];
                if (cell && cell.v) {
                    let val = String(cell.v).replace(/\s+/g, ' ').trim();
                    if (val.length > 0) {
                        rowContent.push(`[${cellRef}]: ${val}`);
                    }
                }
            }
            if (rowContent.length > 0) {
                console.log(`Row ${R + 1}: ${rowContent.join(' | ')}`);
            }
        }
    });

} catch (error) {
    console.error('Error reading file:', error);
}
