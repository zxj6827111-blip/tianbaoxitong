const { sanitizeManualTextByKey, sanitizeArchiveTextByCategory } = require('../src/services/manualTextSanitizer');

describe('manualTextSanitizer', () => {
  it('removes leading organization line with department suffix', () => {
    const input = [
      '\u4e0a\u6d77\u5e02\u666e\u9640\u533a\u4e07\u91cc\u8857\u9053\u529e\u4e8b\u5904\uff08\u90e8\u95e8\uff09',
      '\u4e3b\u8981\u804c\u80fd\u5305\u62ec\uff1a',
      '\uff08\u4e00\uff09\u7edf\u7b79\u57fa\u5c42\u7ba1\u7406\u5de5\u4f5c\u3002'
    ].join('\n');

    const output = sanitizeManualTextByKey('main_functions', input);

    expect(output).toBe([
      '\u4e3b\u8981\u804c\u80fd\u5305\u62ec\uff1a',
      '\uff08\u4e00\uff09\u7edf\u7b79\u57fa\u5c42\u7ba1\u7406\u5de5\u4f5c\u3002'
    ].join('\n'));
  });

  it('removes leading bare organization line when next line repeats it', () => {
    const orgName = '\u4e0a\u6d77\u5e02\u666e\u9640\u533a\u53d1\u5c55\u548c\u6539\u9769\u59d4\u5458\u4f1a';
    const input = [
      orgName,
      `${orgName}\u662f\u4e3b\u7ba1\u5168\u533a\u56fd\u6c11\u7ecf\u6d4e\u548c\u793e\u4f1a\u53d1\u5c55\u7684\u533a\u653f\u5e9c\u5de5\u4f5c\u90e8\u95e8\u3002`
    ].join('\n');

    const output = sanitizeManualTextByKey('organizational_structure', input);

    expect(output).toBe(
      `${orgName}\u662f\u4e3b\u7ba1\u5168\u533a\u56fd\u6c11\u7ecf\u6d4e\u548c\u793e\u4f1a\u53d1\u5c55\u7684\u533a\u653f\u5e9c\u5de5\u4f5c\u90e8\u95e8\u3002`
    );
  });

  it('reflows wrapped lines while keeping numbered paragraphs separated', () => {
    const input = [
      '\uff08\u4e00\uff09\u8d2f\u5f7b\u6267\u884c\u56fd\u6c11\u7ecf\u6d4e\u548c\u793e\u4f1a\u53d1\u5c55\u6218\u7565',
      '\u62df\u8ba2\u5e76\u7ec4\u7ec7\u5b9e\u65bd\u4e2d\u957f\u671f\u89c4\u5212\u3002',
      '\uff08\u4e8c\uff09\u7ec4\u7ec7\u7edf\u7b79\u534f\u8c03\u5de5\u4f5c\u3002'
    ].join('\n');

    const output = sanitizeManualTextByKey('main_functions', input);

    expect(output).toBe([
      '\uff08\u4e00\uff09\u8d2f\u5f7b\u6267\u884c\u56fd\u6c11\u7ecf\u6d4e\u548c\u793e\u4f1a\u53d1\u5c55\u6218\u7565\u62df\u8ba2\u5e76\u7ec4\u7ec7\u5b9e\u65bd\u4e2d\u957f\u671f\u89c4\u5212\u3002',
      '\uff08\u4e8c\uff09\u7ec4\u7ec7\u7edf\u7b79\u534f\u8c03\u5de5\u4f5c\u3002'
    ].join('\n'));
  });

  it('keeps line break after a heading ending with colon', () => {
    const input = [
      '\u4e3b\u8981\u804c\u80fd\u5305\u62ec\uff1a',
      '\uff08\u4e00\uff09\u8d2f\u5f7b\u6267\u884c\u91cd\u70b9\u4efb\u52a1\u3002'
    ].join('\n');

    const output = sanitizeManualTextByKey('main_functions', input);
    expect(output).toBe(input);
  });

  it('reflows wrapped lines for glossary', () => {
    const input = [
      '\uff08\u4e00\uff09\u8d22\u653f\u62e8\u6b3e\u6536\u5165\uff1a\u662f\u533a\u7ea7\u9884\u7b97\u4e3b\u7ba1\u90e8\u95e8\u53ca\u6240\u5c5e\u9884\u7b97\u5355\u4f4d\u672c\u5e74\u5ea6\u4ece\u672c\u7ea7\u8d22\u653f\u90e8\u95e8\u53d6\u5f97\u7684\u8d22\u653f\u62e8\u6b3e\uff0c\u5305\u62ec\u4e00\u822c\u516c\u5171\u9884\u7b97\u8d22\u653f\u62e8\u6b3e\u3001',
      '\u653f\u5e9c\u6027\u57fa\u91d1\u9884\u7b97\u8d22\u653f\u62e8\u6b3e\u548c\u56fd\u6709\u8d44\u672c\u7ecf\u8425\u9884\u7b97\u8d22\u653f\u62e8\u6b3e\u3002'
    ].join('\n');

    const output = sanitizeManualTextByKey('glossary', input);
    expect(output).toBe(
      '\uff08\u4e00\uff09\u8d22\u653f\u62e8\u6b3e\u6536\u5165\uff1a\u662f\u533a\u7ea7\u9884\u7b97\u4e3b\u7ba1\u90e8\u95e8\u53ca\u6240\u5c5e\u9884\u7b97\u5355\u4f4d\u672c\u5e74\u5ea6\u4ece\u672c\u7ea7\u8d22\u653f\u90e8\u95e8\u53d6\u5f97\u7684\u8d22\u653f\u62e8\u6b3e\uff0c\u5305\u62ec\u4e00\u822c\u516c\u5171\u9884\u7b97\u8d22\u653f\u62e8\u6b3e\u3001\u653f\u5e9c\u6027\u57fa\u91d1\u9884\u7b97\u8d22\u653f\u62e8\u6b3e\u548c\u56fd\u6709\u8d44\u672c\u7ecf\u8425\u9884\u7b97\u8d22\u653f\u62e8\u6b3e\u3002'
    );
  });

  it('merges glossary continuation like full-width bracket words', () => {
    const input = [
      '\uff08\u4e09\uff09\u201c\u4e09\u516c\u201d\u7ecf\u8d39\uff1a\u662f\u4e0e\u533a\u7ea7\u8d22\u653f\u6709\u7ecf\u8d39\u9884\u62e8\u5173\u7cfb\u7684\u90e8\u95e8\u53ca\u5176\u4e0b\u5c5e\u9884\u7b97\u5355\u4f4d\u4f7f\u7528\u533a\u7ea7\u8d22\u653f\u62e8\u6b3e\u5b89\u6392\u7684\u56e0\u516c\u51fa\u56fd',
      '\uff08\u5883\uff09\u8d39\u3001\u516c\u52a1\u7528\u8f66\u8d2d\u7f6e\u53ca\u8fd0\u884c\u8d39\u3001\u516c\u52a1\u63a5\u5f85\u8d39\u3002'
    ].join('\n');

    const output = sanitizeManualTextByKey('glossary', input);
    expect(output).toBe(
      '\uff08\u4e09\uff09\u201c\u4e09\u516c\u201d\u7ecf\u8d39\uff1a\u662f\u4e0e\u533a\u7ea7\u8d22\u653f\u6709\u7ecf\u8d39\u9884\u62e8\u5173\u7cfb\u7684\u90e8\u95e8\u53ca\u5176\u4e0b\u5c5e\u9884\u7b97\u5355\u4f4d\u4f7f\u7528\u533a\u7ea7\u8d22\u653f\u62e8\u6b3e\u5b89\u6392\u7684\u56e0\u516c\u51fa\u56fd\uff08\u5883\uff09\u8d39\u3001\u516c\u52a1\u7528\u8f66\u8d2d\u7f6e\u53ca\u8fd0\u884c\u8d39\u3001\u516c\u52a1\u63a5\u5f85\u8d39\u3002'
    );
  });

  it('applies glossary reflow through archive category mapping', () => {
    const input = 'AAAA\nBBBB';
    const output = sanitizeArchiveTextByCategory('TERMINOLOGY', input);
    expect(output).toBe('AAAA BBBB');
  });

  it('does not alter unrelated keys', () => {
    const input = '\u4e0a\u6d77\u5e02\u8d22\u653f\u5c40';
    const output = sanitizeManualTextByKey('budget_explanation', input);
    expect(output).toBe(input);
  });
});
