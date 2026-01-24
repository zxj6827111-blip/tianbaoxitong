const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { ensureReportDir, getReportFilePath } = require('./reportStorage');

const buildWorkbook = ({ values, metadata }) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('填充结果');

  sheet.columns = [
    { header: '类别', key: 'category', width: 20 },
    { header: '键', key: 'key', width: 30 },
    { header: '值', key: 'value', width: 40 }
  ];

  for (const [key, value] of Object.entries(values.facts || {})) {
    sheet.addRow({ category: 'facts', key, value });
  }

  for (const [key, input] of Object.entries(values.manual_inputs || {})) {
    const displayValue = input.value_text ?? input.value_numeric ?? JSON.stringify(input.value_json ?? '');
    sheet.addRow({ category: 'manual_inputs', key, value: displayValue });
  }

  for (const item of values.line_items_reason || []) {
    sheet.addRow({
      category: 'line_items_reason',
      key: item.item_key,
      value: item.reason_text || ''
    });
  }

  const watermark = workbook.addWorksheet('meta', { state: 'hidden' });
  watermark.getCell('A1').value = 'report_version_id';
  watermark.getCell('B1').value = metadata.reportVersionId;
  watermark.getCell('A2').value = 'draft_snapshot_hash';
  watermark.getCell('B2').value = metadata.draftSnapshotHash;
  watermark.getCell('A3').value = 'generated_at';
  watermark.getCell('B3').value = metadata.generatedAt;

  return workbook;
};

const renderExcel = async ({ values, reportVersionId, draftSnapshotHash }) => {
  await ensureReportDir();
  const excelPath = getReportFilePath({ reportVersionId, suffix: 'report.xlsx' });

  const workbook = buildWorkbook({
    values,
    metadata: {
      reportVersionId,
      draftSnapshotHash,
      generatedAt: new Date().toISOString()
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  await require('node:fs/promises').writeFile(excelPath, buffer);
  const excelSha = crypto.createHash('sha256').update(buffer).digest('hex');

  return { excelPath, excelSha };
};

module.exports = {
  renderExcel
};
