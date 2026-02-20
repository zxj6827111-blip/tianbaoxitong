const crypto = require('node:crypto');
const fsConstants = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ensureReportDir, getReportFilePath } = require('./reportStorage');
const { AppError } = require('../errors');

const execFileAsync = promisify(execFile);

const resolveSofficeTempDir = async () => {
  const candidates = [];

  if (process.env.SOFFICE_TEMP_DIR) {
    candidates.push(path.resolve(process.env.SOFFICE_TEMP_DIR));
  }

  if (process.platform === 'win32') {
    const systemDrive = process.env.SystemDrive || 'C:';
    candidates.push(path.join(systemDrive, 'temp', 'govbudget_soffice_tmp'));
  }

  candidates.push(path.join(os.tmpdir(), 'govbudget_soffice_tmp'));

  for (const candidate of candidates) {
    try {
      await fs.mkdir(candidate, { recursive: true });
      await fs.access(candidate, fsConstants.constants.W_OK);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new AppError({
    statusCode: 500,
    code: 'PDF_CONVERSION_FAILED',
    message: 'Unable to prepare writable temp directory for PDF conversion.'
  });
};

const renderPdfFromExcel = async ({ excelPath, reportVersionId, suffix = 'report.pdf' }) => {
  await ensureReportDir();
  const pdfPath = getReportFilePath({ reportVersionId, suffix });
  const soffice = process.env.SOFFICE_PATH || 'soffice';
  const outputDir = path.dirname(pdfPath);
  const sofficeTempDir = await resolveSofficeTempDir();

  try {
    await execFileAsync(
      soffice,
      [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outputDir,
        excelPath
      ],
      {
        env: {
          ...process.env,
          TEMP: sofficeTempDir,
          TMP: sofficeTempDir
        }
      }
    );
  } catch (error) {
    throw new AppError({
      statusCode: 500,
      code: 'PDF_CONVERSION_FAILED',
      message: 'Failed to convert Excel file to PDF.',
      details: {
        stderr: error?.stderr ? String(error.stderr) : null,
        stdout: error?.stdout ? String(error.stdout) : null
      }
    });
  }

  // LibreOffice output filename is based on input filename.
  // If input is "report.xlsx", output is "report.pdf".
  // We need to match the expected pdfPath.
  const expectedOutput = path.join(outputDir, path.basename(excelPath, path.extname(excelPath)) + '.pdf');

  if (expectedOutput !== pdfPath) {
    await fs.rename(expectedOutput, pdfPath);
  }

  const pdfBuffer = await fs.readFile(pdfPath);
  const pdfSha = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  return { pdfPath, pdfSha };
};

module.exports = {
  renderPdfFromExcel
};
