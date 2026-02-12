const XLSX = require('xlsx');
const path = require('path');

const filePath = path.resolve('d:\\软件开发\\谷歌反重力开发\\tianbaoxitong\\tianbaoxitong\\X\\民政及万里两年预算表\\民政局下各单位2025年人大预算表\\002003-上海市普陀区社会福利院-人代会报表制作.xlsx');

console.log(`Analyzing INPUT file: ${filePath}`);

try {
    const workbook = XLSX.readFile(filePath);
    console.log('Sheet Names:', workbook.SheetNames);

    // Analyze the first few sheets to see if they match our expect parsers
    workbook.SheetNames.slice(0, 5).forEach(sheetName => {
        console.log(`\n--- Sheet: ${sheetName} ---`);
        const sheet = workbook.Sheets[sheetName];
        if (!sheet['!ref']) return;

        const range = XLSX.utils.decode_range(sheet['!ref']);
        // Look at first 10 rows
        for (let R = range.s.r; R <= Math.min(range.e.r, 10); ++R) {
            let rowText = [];
            for (let C = range.s.c; C <= Math.min(range.e.c, 5); ++C) {
                const cell = sheet[XLSX.utils.encode_cell({ c: C, r: R })];
                if (cell && cell.v) rowText.push(cell.v);
            }
            if (rowText.length) console.log(`Row ${R + 1}: ${rowText.join(' | ')}`);
        }
    });

} catch (error) {
    console.error('Error reading file:', error);
}
