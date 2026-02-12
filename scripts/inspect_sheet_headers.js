const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../X/民政及万里两年预算表/民政局下各单位2024年人大预算表/002003-上海市普陀区社会福利院-人代会报表制作.xlsx');
const workbook = XLSX.readFile(filePath);

function printSheetInfo(sheetName) {
    console.log(`\n=== Sheet: ${sheetName} ===`);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
        console.log('Sheet not found');
        return;
    }

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    rows.slice(0, 50).forEach((row, index) => {
        const cleanRow = row.map(cell => (cell === null || cell === undefined) ? '' : String(cell).trim());
        // Only print rows that have at least one non-empty string
        if (cleanRow.some(c => c)) {
            console.log(`Row ${index + 1}:`, cleanRow.join(' | '));
        }
    });
}

printSheetInfo('2.15单位收支总表');
printSheetInfo('2.18单位财政拨款收支总表');
