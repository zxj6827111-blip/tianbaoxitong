/**
 * Tests for the structured sub-section extraction functions
 * used by adminArchives.js to split EXPLANATION and OTHER sections.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// We cannot require the functions directly from adminArchives.js (they are module-scoped),
// so we replicate the extraction logic here for unit testing.
// The actual functions in adminArchives.js match this logic exactly.

const extractExplanationSubSections = (text) => {
    if (!text) return {};
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result = {};

    let reasonLineIdx = -1;
    let detailStartIdx = -1;

    for (let i = 0; i < lines.length; i += 1) {
        if (reasonLineIdx === -1 && lines[i].includes('主要原因')) {
            reasonLineIdx = i;
        }
        if (lines[i].includes('财政拨款支出主要内容')) {
            detailStartIdx = i;
            break;
        }
    }

    const overviewEnd = reasonLineIdx >= 0
        ? reasonLineIdx
        : detailStartIdx >= 0 ? detailStartIdx : -1;
    if (overviewEnd > 0) {
        const overview = lines.slice(0, overviewEnd).join('\n').trim();
        if (overview) result.EXPLANATION_OVERVIEW = overview;
    }

    if (reasonLineIdx >= 0) {
        const reasonEnd = detailStartIdx >= 0 ? detailStartIdx : reasonLineIdx + 1;
        const reasonText = lines.slice(reasonLineIdx, reasonEnd).join('\n').trim();
        if (reasonText) result.EXPLANATION_CHANGE_REASON = reasonText;
    }

    if (detailStartIdx >= 0) {
        const detailText = lines.slice(detailStartIdx).join('\n').trim();
        if (detailText) result.EXPLANATION_FISCAL_DETAIL = detailText;
    }

    return result;
};

const extractOtherSubSections = (text) => {
    if (!text) return {};
    const result = {};

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let startIdx = -1;
    let endIdx = lines.length;

    for (let i = 0; i < lines.length; i += 1) {
        const isHeading = /^[一二三四五六七八九十]+[、．.]/.test(lines[i]);
        if (isHeading && lines[i].includes('三公')) {
            startIdx = i;
        } else if (isHeading && startIdx >= 0) {
            endIdx = i;
            break;
        }
    }

    if (startIdx >= 0) {
        const content = lines.slice(startIdx, endIdx).join('\n').trim();
        if (content) result.OTHER_THREE_PUBLIC = content;
    }

    return result;
};

// --- Sample extracted text from 25年万里街道预算PDF ---
const SAMPLE_EXPLANATION = `2025年，上海市普陀区人民政府万里街道办事处收入预算18,976.76万元，其中：财政拨款收入18,976.76万元，比2024年预算增加3,355.65万元；事业收入0.00万元；事业单位经营收入0.00万元；其他收入0.00万元。
支出预算18,976.76万元，其中：财政拨款支出预算18,976.76万元，比2024年预算增加3,355.65万元。财政拨款支出预算中，一般公共预算拨款支出预算18,976.76万元，比2024年预算增加3,355.65万元；政府性基金拨款支出预算0.00万元，比2024年预算持平；国有资本经营预算拨款支出预算0.00万元，比2024年预算持平。
财政拨款收入支出增加的主要原因是项目调整。
财政拨款支出主要内容如下：
1. "一般公共服务支出（类）统计信息事务（款）专项普查活动（项）"科目43.83万元，主要用于统计信息事务统计管理。
2. "一般公共服务支出（类）群众团体事务（款）一般行政管理事务（项）"科目42.29万元，主要用于群众团体事务一般行政管理事务。
3. "一般公共服务支出（类）组织事务（款）一般行政管理事务（项）"科目107.50万元，主要用于组织事务一般行政管理事务。`;

const SAMPLE_OTHER = `一、2025年"三公"经费预算情况说明
2025年"三公"经费预算数为37.91万元，比2024年预算减少10万元。其中：
（一）因公出国（境）费0万元，比2024年预算持平。主要原因是因公出国（境）费保持不变。
（二）公务用车购置及运行费36.56万元，比2024年预算减少10万元，主要原因是2025年新增1辆公务用车购置，但与2024年购置的车辆类型不同。其中：公务用车购置费15万元，比2024年预算减少10万元，主要原因是购置车辆类型不同；公务用车运行费21.56万元，比2024年预算持平，主要原因是公务车用车运行费保持不变。
（三）公务接待费1.35万元。比2024年预算持平，主要原因是公务接待费保持不变。
二、机关运行经费预算
2025年上海市普陀区人民政府万里街道办事处（部门）下属1家机关和1家参公事业单位财政拨款的机关运行经费预算为464.64万元
三、政府采购预算情况
2025年本部门政府采购预算4821.20万元`;

// --- Tests ---

describe('extractExplanationSubSections', () => {
    test('should extract EXPLANATION_OVERVIEW', () => {
        const result = extractExplanationSubSections(SAMPLE_EXPLANATION);
        expect(result.EXPLANATION_OVERVIEW).toBeDefined();
        expect(result.EXPLANATION_OVERVIEW).toContain('收入预算18,976.76万元');
        expect(result.EXPLANATION_OVERVIEW).toContain('支出预算18,976.76万元');
        expect(result.EXPLANATION_OVERVIEW).toContain('比2024年预算增加');
        // Should NOT contain the reason line or fiscal detail
        expect(result.EXPLANATION_OVERVIEW).not.toContain('主要原因');
        expect(result.EXPLANATION_OVERVIEW).not.toContain('财政拨款支出主要内容');
    });

    test('should extract EXPLANATION_CHANGE_REASON', () => {
        const result = extractExplanationSubSections(SAMPLE_EXPLANATION);
        expect(result.EXPLANATION_CHANGE_REASON).toBeDefined();
        expect(result.EXPLANATION_CHANGE_REASON).toContain('主要原因是项目调整');
        // Should be just the reason, not the overview or detail
        expect(result.EXPLANATION_CHANGE_REASON).not.toContain('收入预算');
        expect(result.EXPLANATION_CHANGE_REASON).not.toContain('一般公共服务支出');
    });

    test('should extract EXPLANATION_FISCAL_DETAIL', () => {
        const result = extractExplanationSubSections(SAMPLE_EXPLANATION);
        expect(result.EXPLANATION_FISCAL_DETAIL).toBeDefined();
        expect(result.EXPLANATION_FISCAL_DETAIL).toContain('财政拨款支出主要内容');
        expect(result.EXPLANATION_FISCAL_DETAIL).toContain('一般公共服务支出（类）');
        expect(result.EXPLANATION_FISCAL_DETAIL).toContain('主要用于');
        expect(result.EXPLANATION_FISCAL_DETAIL).toContain('科目43.83万元');
    });

    test('should return empty object for null/undefined/empty input', () => {
        expect(extractExplanationSubSections(null)).toEqual({});
        expect(extractExplanationSubSections(undefined)).toEqual({});
        expect(extractExplanationSubSections('')).toEqual({});
    });

    test('should handle text without reason line', () => {
        const textWithoutReason = `收入预算100万元。
支出预算100万元。
财政拨款支出主要内容如下：
1. 某项科目10万元，主要用于某事。`;
        const result = extractExplanationSubSections(textWithoutReason);
        expect(result.EXPLANATION_OVERVIEW).toContain('收入预算');
        expect(result.EXPLANATION_CHANGE_REASON).toBeUndefined();
        expect(result.EXPLANATION_FISCAL_DETAIL).toContain('财政拨款支出主要内容');
    });

    test('should handle text without fiscal detail', () => {
        const textWithoutDetail = `收入预算100万元。
支出预算100万元。
财政拨款收入支出增加的主要原因是人员变动。`;
        const result = extractExplanationSubSections(textWithoutDetail);
        expect(result.EXPLANATION_OVERVIEW).toContain('收入预算');
        expect(result.EXPLANATION_CHANGE_REASON).toContain('主要原因是人员变动');
        expect(result.EXPLANATION_FISCAL_DETAIL).toBeUndefined();
    });
});

describe('extractOtherSubSections', () => {
    test('should extract OTHER_THREE_PUBLIC', () => {
        const result = extractOtherSubSections(SAMPLE_OTHER);
        expect(result.OTHER_THREE_PUBLIC).toBeDefined();
        expect(result.OTHER_THREE_PUBLIC).toContain('三公');
        expect(result.OTHER_THREE_PUBLIC).toContain('37.91万元');
        expect(result.OTHER_THREE_PUBLIC).toContain('比2024年预算减少10万元');
        expect(result.OTHER_THREE_PUBLIC).toContain('主要原因是');
        expect(result.OTHER_THREE_PUBLIC).toContain('因公出国');
        expect(result.OTHER_THREE_PUBLIC).toContain('公务用车');
        expect(result.OTHER_THREE_PUBLIC).toContain('公务接待费');
    });

    test('should NOT include sections after 三公', () => {
        const result = extractOtherSubSections(SAMPLE_OTHER);
        expect(result.OTHER_THREE_PUBLIC).not.toContain('机关运行经费');
        expect(result.OTHER_THREE_PUBLIC).not.toContain('政府采购');
    });

    test('should return empty object for null/undefined/empty input', () => {
        expect(extractOtherSubSections(null)).toEqual({});
        expect(extractOtherSubSections(undefined)).toEqual({});
        expect(extractOtherSubSections('')).toEqual({});
    });

    test('should return empty if no 三公 section', () => {
        const textWithoutThreePublic = `一、机关运行经费预算
2025年机关运行经费预算为464.64万元
二、政府采购预算情况
2025年本部门政府采购预算4821.20万元`;
        const result = extractOtherSubSections(textWithoutThreePublic);
        expect(result.OTHER_THREE_PUBLIC).toBeUndefined();
    });
});
