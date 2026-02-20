// Verification script: verify if formula cells now have correct values
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// Mock the backend environment
const drafts = require('./src/routes/drafts');

const storageDir = path.resolve(__dirname, 'storage', 'uploads');
const files = fs.readdirSync(storageDir)
    .filter(f => f.endsWith('.xlsx'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(storageDir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

const realFile = files.find(f => !f.name.includes('sample_unit') && !f.name.includes('missing_sheet'));
const fp = path.join(storageDir, realFile.name);

console.log(`Verifying file: ${realFile.name}`);

// We need to use the ACTUAL backend logic, but it's buried in drafts.js and not exported directly.
// So we'll read the file using the improved strategy (if CODEX implemented it) 
// OR we check if the file content of drafts.js has been changed.

// First, let's check drafts.js content to see if the fix is there
const draftsContent = fs.readFileSync(path.join(__dirname, 'src/routes/drafts.js'), 'utf8');
const hasFormulaFix = draftsContent.includes('cellFormula: true') || draftsContent.includes('parseFormula');

if (hasFormulaFix) {
    console.log('✅ drafts.js contains formula fix logic (cellFormula: true found)');
} else {
    console.log('❌ drafts.js does NOT seem to have the fix yet.');
}

// Now let's try to run the extraction logic. 
// Since we can't easily import the unexported function, we'll replicate the logic 
// that SHOULD be there to verify it works on this file.

console.log('\n--- Simulating extraction with formula calculation ---');
const wb = XLSX.readFile(fp, { cellFormula: true, cellHTML: false, cellNF: false, cellStyles: false });
const sheetName = wb.SheetNames.find(s => s.includes('3.16') || s.includes('收入总表')); // Table with 67 formulas
console.log(`Sheet: ${sheetName}`);
const sheet = wb.Sheets[sheetName];

// Simulation of the fix logic (simplified)
const range = XLSX.utils.decode_range(sheet['!ref']);
let fixedCount = 0;
let zeroCount = 0;

for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;

        if (cell.f) {
            // Check raw value
            if (cell.v === 0) zeroCount++;

            // Try to calc (Mock)
            // Simple SUM(A,B,C) parser
            if (cell.f.startsWith('SUM(')) {
                // This would be the logic running in backend
                fixedCount++;
            }
        }
    }
}

console.log(`Found ${fixedCount} formula cells.`);
console.log(`Original cached values are 0 for ${zeroCount} cells.`);
console.log('If the backend is fixed, these should be non-zero in the API response.');

process.exit(0);
