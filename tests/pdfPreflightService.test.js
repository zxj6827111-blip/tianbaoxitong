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

  it('allows a single interior blank page', async () => {
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
          { num: 2, text: '' },
          { num: 3, text: '七、项目经费情况说明 本页也有足够文本用于通过校验。' }
        ]
      }),
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    PDFParse.mockImplementation(() => parser);

    const report = await validatePdfOutput({ pdfPath: 'mock.pdf' });
    expect(report.pageCount).toBe(3);
    expect(report.blankPages).toEqual([2]);
    const findingCodes = report.findings.map((item) => item.code);
    expect(findingCodes).not.toContain('INTERIOR_BLANK_PAGES');
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not flag sparse text on table-like pages', async () => {
    const parser = {
      getInfo: jest.fn().mockResolvedValue({
        pages: [
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 }
        ]
      }),
      getText: jest.fn().mockResolvedValue({
        text: 'table only',
        pages: [
          { num: 1, text: '\u90e8\u95e8\u9884\u7b9702\u8868' },
          { num: 2, text: '\u5408\u8ba1' }
        ]
      }),
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    PDFParse.mockImplementation(() => parser);

    let error;
    try {
      await validatePdfOutput({ pdfPath: 'mock.pdf' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe('PDF_PREFLIGHT_FAILED');
    const codes = (error.details?.findings || []).map((item) => item.code);
    expect(codes).not.toContain('SPARSE_PAGES');
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });

  it('still flags sparse text on narrative pages', async () => {
    const parser = {
      getInfo: jest.fn().mockResolvedValue({
        pages: [
          { width: 841.68, height: 595.44 },
          { width: 841.68, height: 595.44 }
        ]
      }),
      getText: jest.fn().mockResolvedValue({
        text: 'narrative',
        pages: [
          { num: 1, text: '\u540d\u8bcd\u89e3\u91ca' },
          { num: 2, text: '\u8fd9\u662f\u6b63\u6587\u5185\u5bb9\u3002\u8fd9\u4e00\u9875\u6709\u5b8c\u6574\u53e5\u5b50\u4e14\u6587\u5b57\u8db3\u591f\u957f\u3002' }
        ]
      }),
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    PDFParse.mockImplementation(() => parser);

    let error;
    try {
      await validatePdfOutput({ pdfPath: 'mock.pdf' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe('PDF_PREFLIGHT_FAILED');
    const sparseFinding = (error.details?.findings || []).find((item) => item.code === 'SPARSE_PAGES');
    expect(sparseFinding).toBeDefined();
    expect(sparseFinding.pages.map((item) => item.page)).toContain(1);
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });
});
