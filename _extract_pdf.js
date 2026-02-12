const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const filePath = process.argv[2] || 'X/24年预算公开报告/上海市普陀区人民政府万里街道办事处25年预算.pdf';
const outPath = '_pdf25_text.txt';

// Force exit after 30 seconds to prevent hanging
setTimeout(() => {
    console.error('Timeout - force exit');
    process.exit(1);
}, 30000);

(async () => {
    const buf = fs.readFileSync(filePath);
    console.log('File read, size:', buf.length);

    const parser = new PDFParse({ data: buf });
    const data = await parser.getText({
        cellSeparator: '\t',
        lineEnforce: true,
        pageJoiner: '\n-- PAGE_BREAK --\n'
    });

    const text = data.text || '';
    fs.writeFileSync(outPath, text, 'utf8');
    console.log('Done, text length:', text.length);

    await parser.destroy();
    process.exit(0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
