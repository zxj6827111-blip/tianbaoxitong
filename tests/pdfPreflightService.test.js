jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn()
}));

const fs = require('node:fs/promises');
const { PDFParse } = require('pdf-parse');
const { validatePdfOutput } = require('../src/services/pdfPreflightService');

describe('pdfPreflightService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('dummy'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes for A4 PDF with required sections and no excessive blank pages', async () => {
    const parser = {
      getInfo: jest.fn().mockResolvedValue({
        pages: [
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 }
        ]
      }),
      getText: jest.fn().mockResolvedValue({
        text: '六、其他相关情况说明 七、项目经费情况说明 政府性基金预算支出功能分类预算表 国有资本经营预算支出功能分类预算表 “三公”经费和机关运行经费预算表',
        pages: [
          { num: 1, text: '六、其他相关情况说明 本页有足够文本用于通过校验。' },
          { num: 2, text: '中间页也有足够文本，确保不存在夹在正文中的空白页。' },
          { num: 3, text: '七、项目经费情况说明 本页也有足够文本用于通过校验。' }
        ]
      }),
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    PDFParse.mockImplementation(() => parser);

    const report = await validatePdfOutput({ pdfPath: 'mock.pdf' });
    expect(report.pageCount).toBe(3);
    expect(report.findings).toHaveLength(0);
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });

  it('fails when too many blank pages are present', async () => {
    const parser = {
      getInfo: jest.fn().mockResolvedValue({
        pages: [
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 }
        ]
      }),
      getText: jest.fn().mockResolvedValue({
        text: '六、其他相关情况说明 七、项目经费情况说明 政府性基金预算支出功能分类预算表 国有资本经营预算支出功能分类预算表 “三公”经费和机关运行经费预算表',
        pages: [
          { num: 1, text: '六、其他相关情况说明 这是正文。' },
          { num: 2, text: '' },
          { num: 3, text: '' },
          { num: 4, text: '七、项目经费情况说明 这是正文。' }
        ]
      }),
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    PDFParse.mockImplementation(() => parser);

    await expect(validatePdfOutput({ pdfPath: 'mock.pdf' })).rejects.toMatchObject({
      code: 'PDF_PREFLIGHT_FAILED',
      statusCode: 422
    });
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });
});
