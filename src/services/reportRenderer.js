const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { loadTemplate, applyTemplate } = require('./reportTemplateService');
const { ensureReportDir, getReportFilePath } = require('./reportStorage');

const baseFontCss = "body { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; }";

const renderPdf = async ({ templateVersion, values, reportVersionId }) => {
  const { html } = await loadTemplate(templateVersion);
  const populated = applyTemplate({ html, values });
  const fontCss = baseFontCss;

  const content = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    ${fontCss}
    @page { size: A4; margin: 24mm 18mm; }
    body { font-size: 12pt; line-height: 1.6; }
    .page-break { page-break-after: always; }
    ul.line-items { margin: 0; padding-left: 18px; }
  </style>
</head>
<body>
${populated}
</body>
</html>`;

  await ensureReportDir();
  const pdfPath = getReportFilePath({ reportVersionId, suffix: 'report.pdf' });

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(content, { waitUntil: 'networkidle' });
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '24mm', bottom: '24mm', left: '18mm', right: '18mm' } });
  await browser.close();

  const pdfBuffer = await fs.readFile(pdfPath);
  const pdfSha = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  return { pdfPath, pdfSha };
};

module.exports = {
  renderPdf
};
