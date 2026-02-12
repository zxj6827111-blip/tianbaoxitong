const { __private } = require('../src/services/excelFiller');

describe('excelFiller project expense block', () => {
  it('always emits section seven header even when project fields are empty', () => {
    const block = __private.buildProjectExpenseBlock({ manual_inputs: {} });

    expect(block).toContain('七、项目经费情况说明');
    expect(block).toContain('一、项目概述');
    expect(block).toContain('\n无\n');
  });

  it('includes project section in other notes payload', () => {
    const payload = __private.buildPayload({
      values: {
        manual_inputs: {
          other_notes: { value_text: '五、国有资产占有使用情况\n无' }
        }
      },
      year: 2024
    });

    expect(payload.manualTexts.other_notes).toContain('五、国有资产占有使用情况');
    expect(payload.manualTexts.other_notes).toContain('七、项目经费情况说明');
  });

  it('does not duplicate project section when other notes already contain it', () => {
    const payload = __private.buildPayload({
      values: {
        manual_inputs: {
          other_notes: { value_text: '七、项目经费情况说明\n已手工填写内容' }
        }
      },
      year: 2024
    });

    const occurrences = (payload.manualTexts.other_notes.match(/七、项目经费情况说明/g) || []).length;
    expect(occurrences).toBe(1);
  });
});
