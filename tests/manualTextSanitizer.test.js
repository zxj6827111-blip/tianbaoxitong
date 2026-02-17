const { sanitizeManualTextByKey } = require('../src/services/manualTextSanitizer');

describe('manualTextSanitizer', () => {
  it('removes leading organization line for main_functions', () => {
    const input = [
      '上海市普陀区人民政府万里街道办事处（部门）',
      '上海市普陀区人民政府万里街道办事处是普陀区政府的派出机关。',
      '主要职能包括：'
    ].join('\n');

    const output = sanitizeManualTextByKey('main_functions', input);

    expect(output).toBe([
      '上海市普陀区人民政府万里街道办事处是普陀区政府的派出机关。',
      '主要职能包括：'
    ].join('\n'));
  });

  it('removes leading organization line with section suffix', () => {
    const input = [
      '上海市普陀区人民政府万里街道办事处（部门）机构设置',
      '本部门中，行政单位1家，事业单位4家。'
    ].join('\n');

    const output = sanitizeManualTextByKey('organizational_structure', input);

    expect(output).toBe('本部门中，行政单位1家，事业单位4家。');
  });

  it('keeps content when first line is normal body text', () => {
    const input = [
      '主要职能包括：',
      '一、加强党的建设。'
    ].join('\n');

    const output = sanitizeManualTextByKey('main_functions', input);
    expect(output).toBe(input);
  });

  it('does not alter unrelated keys', () => {
    const input = '上海市普陀区人民政府万里街道办事处（部门）';
    const output = sanitizeManualTextByKey('glossary', input);
    expect(output).toBe(input);
  });
});
