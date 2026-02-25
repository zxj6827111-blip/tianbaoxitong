const { __private } = require('../src/services/archivePdfIngestService');

describe('archivePdfIngestService', () => {
  it('normalizeReportType respects explicit type and infers from filename', () => {
    expect(__private.normalizeReportType('BUDGET', 'x.pdf')).toBe('BUDGET');
    expect(__private.normalizeReportType('FINAL', 'x.pdf')).toBe('FINAL');
    expect(__private.normalizeReportType('', '某部门25年决算.pdf')).toBe('FINAL');
    expect(__private.normalizeReportType('', '某部门25年预算.pdf')).toBe('BUDGET');
  });

  it('extractSectionsFromText splits known heading sections', () => {
    const text = [
      '一、主要职能',
      '负责统筹协调。',
      '二、机构设置',
      '下设3个科室。',
      '三、名词解释',
      '财政拨款：指...'
    ].join('\n');

    const sections = __private.extractSectionsFromText(text);
    expect(sections.FUNCTION).toContain('负责统筹协调');
    expect(sections.STRUCTURE).toContain('下设3个科室');
    expect(sections.TERMINOLOGY).toContain('财政拨款');
  });

  it('extractExplanationSubSections extracts fiscal detail section', () => {
    const text = [
      '2025年部门收支预算情况说明',
      '主要原因：政策调整。',
      '财政拨款支出主要内容如下：',
      '1. 用于民生保障。'
    ].join('\n');

    const sections = __private.extractExplanationSubSections(text);
    expect(sections.EXPLANATION_CHANGE_REASON).toContain('主要原因');
    expect(sections.EXPLANATION_FISCAL_DETAIL).toContain('财政拨款支出主要内容');
  });
});
