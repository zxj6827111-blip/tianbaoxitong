const fs = require('fs');
// Directly require the CJS file to avoid ESM/CJS interop issues in script runner
const pdf = require('pdf-parse/dist/pdf-parse/cjs/index.cjs');
console.log('Type of pdf:', typeof pdf);
console.log('pdf export:', pdf);
const path = require('path');

// Hardcode the path for debugging certainty
const filePath = 'd:\\软件开发\\谷歌反重力开发\\tianbaoxitong\\tianbaoxitong\\uploads\\archives\\1769321433314-826553525.pdf';

console.log('Reading file:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File does not exist');
    process.exit(1);
}

try {
    const dataBuffer = fs.readFileSync(filePath);
    console.log('File read, size:', dataBuffer.length);

    pdf(dataBuffer).then(function (data) {
        console.log('--- raw text start ---');
        console.log(data.text.substring(0, 2000)); // Print first 2000 chars
        console.log('--- raw text end ---');
    }).catch(err => {
        console.error('PDF parsing error:', err);
    });
} catch (e) {
    console.error('File read error:', e);
}
