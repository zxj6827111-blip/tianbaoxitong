const ExcelJS = require('exceljs');
const path = require('node:path');
const fs = require('node:fs/promises');

const buildSampleUnitWorkbook = ({ year = 2024 } = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('预算汇总');
  const fiscalSheet = workbook.addWorksheet('财政拨款收支总表');

  sheet.getCell('A1').value = '单位预算汇总表';
  sheet.getCell('A2').value = '单位名称';
  sheet.getCell('B2').value = '样例单位';
  sheet.getCell('A3').value = '年度';
  sheet.getCell('B3').value = year;

  sheet.getCell('A5').value = '科目';
  sheet.getCell('B5').value = '预算数（万元）';

  const rows = [
    ['收入合计', 1100.0],
    ['其中：财政拨款收入', 1000.0],
    ['事业收入', 65.44],
    ['其他收入', 34.56],
    ['支出合计', 1100.0],
    ['基本支出', 800.0],
    ['项目支出', 300.0],
    ['其中：人员经费', 500.0],
    ['公用经费', 300.0],
    ['项目支出-资本性', 120.0],
    ['项目支出-非资本性', 180.0],
    ['结余', 0.0]
  ];

  let rowIndex = 6;
  for (const [label, value] of rows) {
    sheet.getCell(`A${rowIndex}`).value = label;
    const cell = sheet.getCell(`B${rowIndex}`);
    cell.value = value;
    cell.numFmt = '#,##0.00"万元"';
    rowIndex += 1;
  }

  sheet.columns.forEach((column) => {
    column.width = 18;
  });

  fiscalSheet.getCell('A1').value = '财政拨款收支总表';
  fiscalSheet.getCell('A3').value = '科目';
  fiscalSheet.getCell('B3').value = '预算数（万元）';

  const fiscalRows = [
    ['拨款收入合计', 1000.0],
    ['拨款支出合计', 1000.0]
  ];

  let fiscalRowIndex = 4;
  for (const [label, value] of fiscalRows) {
    fiscalSheet.getCell(`A${fiscalRowIndex}`).value = label;
    const cell = fiscalSheet.getCell(`B${fiscalRowIndex}`);
    cell.value = value;
    cell.numFmt = '#,##0.00"万元"';
    fiscalRowIndex += 1;
  }

  fiscalSheet.columns.forEach((column) => {
    column.width = 18;
  });

  return workbook;
};

const generateSampleUnitBuffer = async (options) => {
  const workbook = buildSampleUnitWorkbook(options);
  return workbook.xlsx.writeBuffer();
};

if (require.main === module) {
  const outputPath = process.argv[2] || path.resolve(process.cwd(), 'sample_unit.xlsx');
  generateSampleUnitBuffer()
    .then((buffer) => fs.writeFile(outputPath, buffer))
    .then(() => {
      console.log(`Sample Excel generated at ${outputPath}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  buildSampleUnitWorkbook,
  generateSampleUnitBuffer
};
