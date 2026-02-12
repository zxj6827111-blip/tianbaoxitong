const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureReportDir, getReportFilePath } = require('./reportStorage');
const { fillExcelTemplate } = require('./excelFiller');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_CANDIDATES = [
  path.resolve(PROJECT_ROOT, 'templates', 'budget_template.xls'),
  path.resolve(PROJECT_ROOT, 'X', 'department_template.xls')
];

const resolveTemplatePath = () => {
  const existing = TEMPLATE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (existing) {
    return existing;
  }

  const error = new Error('No Excel template found for report generation.');
  error.code = 'TEMPLATE_NOT_FOUND';
  error.candidates = TEMPLATE_CANDIDATES;
  throw error;
};

const renderExcel = async ({ values, reportVersionId, draftSnapshotHash, sourcePath, year, suffix = 'report.xls' }) => {
  await ensureReportDir();
  const excelPath = getReportFilePath({ reportVersionId, suffix }); // Use .xls to match template compatibility
  const templatePath = resolveTemplatePath();

  try {
    await fillExcelTemplate({
      templatePath,
      sourcePath,
      outputPath: excelPath,
      values,
      year
    });
  } catch (error) {
    console.error('Error filling Excel template:', error);
    throw error;
  }

  const buffer = await require('node:fs/promises').readFile(excelPath);
  const excelSha = crypto.createHash('sha256').update(buffer).digest('hex');

  return { excelPath, excelSha };
};

module.exports = {
  renderExcel
};
