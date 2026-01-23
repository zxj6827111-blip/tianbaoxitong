const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');

const buildHistoryWorkbook = ({
  year = 2023,
  unitCode = 'U100',
  keys = [],
  sheetName = 'history'
} = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.getCell('A1').value = 'unit_code';
  sheet.getCell('B1').value = 'year';
  sheet.getCell('C1').value = 'key';
  sheet.getCell('D1').value = 'value_wanyuan';
  sheet.getCell('E1').value = 'note';

  let rowIndex = 2;
  keys.forEach((key, index) => {
    sheet.getCell(`A${rowIndex}`).value = unitCode;
    sheet.getCell(`B${rowIndex}`).value = year;
    sheet.getCell(`C${rowIndex}`).value = key;
    sheet.getCell(`D${rowIndex}`).value = index + 1;
    sheet.getCell(`E${rowIndex}`).value = `note-${index + 1}`;
    rowIndex += 1;
  });

  sheet.columns.forEach((column) => {
    column.width = 20;
  });

  return workbook;
};

const generateHistorySampleBuffer = async (options) => {
  const workbook = buildHistoryWorkbook(options);
  return workbook.xlsx.writeBuffer();
};

const optionsFromArgs = (args) => {
  if (!args || args.length === 0) {
    return [];
  }
  return args.join(',').split(',').map((key) => key.trim()).filter(Boolean);
};

if (require.main === module) {
  const outputPath = process.argv[2] || path.resolve(process.cwd(), 'history_sample.xlsx');
  generateHistorySampleBuffer({
    keys: optionsFromArgs(process.argv.slice(3))
  })
    .then((buffer) => fs.writeFile(outputPath, buffer))
    .then(() => {
      console.log(`History Excel generated at ${outputPath}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  buildHistoryWorkbook,
  generateHistorySampleBuffer
};
