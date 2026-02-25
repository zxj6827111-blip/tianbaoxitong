jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn()
}));

const { PDFParse } = require('pdf-parse');
const {
  extractPdfText,
  identifyUnitAndYear,
  matchExistingUnit,
  normalizeUploadedFilename,
  __private
} = require('../src/services/pdfBatchService');

const { BUDGET_SCOPE } = __private;

describe('pdfBatchService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('extractPdfText uses PDFParse v2 API and always destroys parser', async () => {
    const parser = {
      getText: jest.fn().mockResolvedValue({ text: '  单位名称：上海市财政局  ' }),
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    PDFParse.mockImplementation(() => parser);

    const text = await extractPdfText(Buffer.from('mock-pdf'));

    expect(text).toBe('单位名称：上海市财政局');
    expect(PDFParse).toHaveBeenCalledWith({ data: expect.any(Buffer) });
    expect(parser.getText).toHaveBeenCalledTimes(1);
    expect(parser.destroy).toHaveBeenCalledTimes(1);
  });

  it('identifyUnitAndYear detects department cover labels even with random filename', () => {
    const result = identifyUnitAndYear(
      'ce1861818603488f86adf382900bee53.pdf',
      [
        '上海市普陀区2025年区级部门预算',
        '预算主管部门：上海市普陀区司法局'
      ].join('\n')
    );

    expect(result.scope).toBe(BUDGET_SCOPE.DEPARTMENT);
    expect(result.unitName).toBe('上海市普陀区司法局');
    expect(result.unitSource).toBe('cover_department_label');
    expect(result.year).toBe(2025);
    expect(result.yearSource).toBe('text');
  });

  it('identifyUnitAndYear detects unit cover labels', () => {
    const result = identifyUnitAndYear(
      'random.pdf',
      [
        '上海市普陀区2025年区级单位预算',
        '预算单位：上海市普陀区司法局'
      ].join('\n')
    );

    expect(result.scope).toBe(BUDGET_SCOPE.UNIT);
    expect(result.unitName).toBe('上海市普陀区司法局');
    expect(result.unitSource).toBe('cover_unit_label');
    expect(result.year).toBe(2025);
  });

  it('identifyUnitAndYear strips trailing unit-noise like "单位：元"', () => {
    const result = identifyUnitAndYear(
      '年度报告.pdf',
      '编制单位：上海市普陀区人民政府办公室 单位：元\n正文'
    );

    expect(result.unitName).toBe('上海市普陀区人民政府办公室');
    expect(result.unitSource).toBe('text_label');
  });

  it('identifyUnitAndYear falls back to filename when text has no unit hint', () => {
    const result = identifyUnitAndYear('上海市财政局_2025年预算公开.pdf', '正文内容');

    expect(result.unitName).toBe('上海市财政局');
    expect(result.unitSource).toBe('filename');
    expect(result.year).toBe(2025);
    expect(result.yearSource).toBe('filename');
  });

  it('identifyUnitAndYear does not parse hash-like filename digits as year', () => {
    const result = identifyUnitAndYear(
      '5af19c4bb64849dba1a4bf195042e0a9.pdf',
      '预算单位：上海市普陀区万里街道城市运行管理中心'
    );

    expect(result.year).toBeNull();
    expect(result.yearSource).toBeNull();
  });

  it('identifyUnitAndYear prefers text year over conflicting filename digits', () => {
    const result = identifyUnitAndYear(
      '5420969b9ff14e9aa03717a4125007bf.pdf',
      '上海市普陀区2025年区级单位预算\n预算单位：上海市普陀区万里街道综合行政执法队'
    );

    expect(result.year).toBe(2025);
    expect(result.yearSource).toBe('text');
  });

  it('matchExistingUnit prefers department-level default unit under department scope', () => {
    const catalog = [
      {
        id: 'u1',
        name: '上海市普陀区司法局本级',
        department_id: 'd1',
        department_name: '上海市普陀区司法局'
      },
      {
        id: 'u2',
        name: '上海市普陀区司法局法律援助中心',
        department_id: 'd1',
        department_name: '上海市普陀区司法局'
      },
      {
        id: 'u3',
        name: '上海市普陀区生态环境局本级',
        department_id: 'd2',
        department_name: '上海市普陀区生态环境局'
      }
    ];

    const matched = matchExistingUnit('上海市普陀区司法局', catalog, {
      scope: BUDGET_SCOPE.DEPARTMENT
    });

    expect(matched).toBeTruthy();
    expect(matched.unit.id).toBe('u1');
    expect(matched.match_type).toBe('exact');
  });

  it('matchExistingUnit maps 本部 alias to department-level unit under unit scope', () => {
    const catalog = [
      {
        id: 'u1',
        name: '上海市普陀区人民政府万里街道办事处本级',
        department_id: 'd1',
        department_name: '上海市普陀区人民政府万里街道办事处'
      },
      {
        id: 'u2',
        name: '上海市普陀区万里街道社区事务受理服务中心',
        department_id: 'd1',
        department_name: '上海市普陀区人民政府万里街道办事处'
      }
    ];

    const matched = matchExistingUnit('上海市普陀区人民政府万里街道办事处本部', catalog, {
      scope: BUDGET_SCOPE.UNIT
    });

    expect(matched).toBeTruthy();
    expect(matched.unit.id).toBe('u1');
    expect(matched.match_type).toBe('exact');
  });

  it('normalizeUploadedFilename repairs UTF8/Latin1 mojibake names', () => {
    const mojibake = Buffer.from('上海市预算.pdf', 'utf8').toString('latin1');

    expect(normalizeUploadedFilename(mojibake)).toBe('上海市预算.pdf');
    expect(normalizeUploadedFilename('report-2025.pdf')).toBe('report-2025.pdf');
  });
});
