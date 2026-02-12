const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ensureReportDir, getReportFilePath } = require('./reportStorage');

const execFileAsync = promisify(execFile);

const renderPdfFromExcel = async ({ excelPath, reportVersionId, suffix = 'report.pdf' }) => {
  await ensureReportDir();
  const pdfPath = getReportFilePath({ reportVersionId, suffix });
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'convert_excel_to_pdf.ps1');

  await execFileAsync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath
  ], {
    env: {
      ...process.env,
      EXCEL_PATH: excelPath,
      PDF_PATH: pdfPath
    }
  });

  const pdfBuffer = await fs.readFile(pdfPath);
  const pdfSha = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  return { pdfPath, pdfSha };
};

module.exports = {
  renderPdfFromExcel
};
