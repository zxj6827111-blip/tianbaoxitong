const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureReportDir, getReportFilePath } = require('./reportStorage');
const { fillExcelTemplate } = require('./excelFiller');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_DIR = path.resolve(PROJECT_ROOT, 'templates', 'excel');
const TEMPLATE_FILE_BY_CALIBER = {
  unit: 'unit_budget_template.xlsx',
  department: 'department_budget_template.xlsx'
};

const resolveTemplatePath = (caliber = 'unit') => {
  const normalizedCaliber = caliber === 'department' ? 'department' : 'unit';
  const fileName = TEMPLATE_FILE_BY_CALIBER[normalizedCaliber];
  const templatePath = path.resolve(TEMPLATE_DIR, fileName);

  if (fs.existsSync(templatePath)) {
    return templatePath;
  }

  const error = new Error('No Excel template found for report generation.');
  error.code = 'TEMPLATE_NOT_FOUND';
  error.caliber = normalizedCaliber;
  error.templateDir = TEMPLATE_DIR;
  error.expectedFile = fileName;
  throw error;
};

const renderExcel = async ({ values, reportVersionId, draftSnapshotHash, sourcePath, year, caliber = 'unit', suffix = 'report.xlsx' }) => {
  await ensureReportDir();
  const excelPath = getReportFilePath({ reportVersionId, suffix });
  const templatePath = resolveTemplatePath(caliber);

  try {
    await fillExcelTemplate({
      templatePath,
      sourcePath,
      outputPath: excelPath,
      values,
      year,
      caliber
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
