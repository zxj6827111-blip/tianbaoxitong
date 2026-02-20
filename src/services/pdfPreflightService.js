const fs = require('node:fs/promises');
const { PDFParse } = require('pdf-parse');
const { AppError } = require('../errors');

const A4_LANDSCAPE = { width: 841.68, height: 595.44 };
const SIZE_TOLERANCE = 1.2;
const MAX_BLANK_PAGE_COUNT = 1;
const MAX_INTERIOR_BLANK_PAGE_COUNT = 1;
const MIN_CHAR_COUNT_FOR_NON_BLANK = 24;

const REQUIRED_TERMS = [
  { key: 'section_7_project_expense', text: '七、项目经费情况说明' },
  { key: 'section_6_other_notes', text: '六、其他相关情况说明' },
  { key: 'table_gov_fund', text: '政府性基金预算支出功能分类预算表' },
  { key: 'table_state_capital', text: '国有资本经营预算支出功能分类预算表' },
  { key: 'table_three_public', text: '“三公”经费和机关运行经费预算表' }
];

const normalize = (text) => String(text || '').replace(/\s+/g, '');

const TABLE_LIKE_HINTS = [
  '\u90e8\u95e8\u9884\u7b97',
  '\u9884\u7b97\u8868',
  '\u5355\u4f4d\uff1a',
  '\u529f\u80fd\u5206\u7c7b\u79d1\u76ee\u7f16\u7801',
  '\u7c7b',
  '\u6b3e',
  '\u9879',
  '\u5408\u8ba1',
  '\u57fa\u672c\u652f\u51fa',
  '\u9879\u76ee\u652f\u51fa',
  '\u6536\u5165\u9884\u7b97',
  '\u652f\u51fa\u9884\u7b97',
  '\u4e00\u822c\u516c\u5171\u9884\u7b97',
  '\u653f\u5e9c\u6027\u57fa\u91d1\u9884\u7b97',
  '\u56fd\u6709\u8d44\u672c\u7ecf\u8425\u9884\u7b97',
  '\u4e09\u516c\u7ecf\u8d39',
  '\u673a\u5173\u8fd0\u884c\u7ecf\u8d39'
];

const FRONT_MATTER_HINTS = [
  '\u76ee\u5f55',
  '\u9884\u7b97\u4e3b\u7ba1\u90e8\u95e8',
  '\u533a\u7ea7\u90e8\u95e8\u9884\u7b97',
  '\u90e8\u95e8\u9884\u7b97\u7f16\u5236\u8bf4\u660e'
];

const NARRATIVE_HINTS = [
  '\u90e8\u95e8\u4e3b\u8981\u804c\u80fd',
  '\u90e8\u95e8\u673a\u6784\u8bbe\u7f6e',
  '\u540d\u8bcd\u89e3\u91ca',
  '\u5176\u4ed6\u76f8\u5173\u60c5\u51b5\u8bf4\u660e',
  '\u9879\u76ee\u7ecf\u8d39\u60c5\u51b5\u8bf4\u660e',
  '\u8d22\u653f\u62e8\u6b3e\u652f\u51fa\u4e3b\u8981\u5185\u5bb9'
];

const containsAny = (text, tokens) => tokens.some((token) => text.includes(token));

const isNarrativePageForSparseCheck = (rawText) => {
  const text = String(rawText || '');
  const compact = normalize(text);
  if (!compact) return false;
  if (containsAny(compact, TABLE_LIKE_HINTS) || containsAny(compact, FRONT_MATTER_HINTS)) {
    return false;
  }
  if (containsAny(compact, NARRATIVE_HINTS)) {
    return true;
  }

  const sentenceEndCount = (text.match(/[\u3002\uff01\uff1f\uff1b]/g) || []).length;
  const commaCount = (text.match(/[\uff0c\u3001]/g) || []).length;
  const digitCount = (compact.match(/\d/g) || []).length;
  const digitRatio = compact.length > 0 ? digitCount / compact.length : 0;

  return (sentenceEndCount >= 1 || commaCount >= 2) && digitRatio < 0.35;
};

const isNearA4Landscape = (page) => {
  const width = Number(page?.width || 0);
  const height = Number(page?.height || 0);
  return Math.abs(width - A4_LANDSCAPE.width) <= SIZE_TOLERANCE
    && Math.abs(height - A4_LANDSCAPE.height) <= SIZE_TOLERANCE;
};

const validatePdfOutput = async ({ pdfPath }) => {
  const pdfBuffer = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const info = await parser.getInfo({ parsePageInfo: true });
    const textData = await parser.getText({ parsePageInfo: true });
    const pages = Array.isArray(textData.pages) ? textData.pages : [];
    const pageInfo = Array.isArray(info.pages) ? info.pages : [];

    const findings = [];

    if (pages.length === 0) {
      findings.push({ code: 'NO_PAGES', message: 'PDF contains no readable pages.' });
    }

    const nonA4Pages = [];
    pageInfo.forEach((page, idx) => {
      if (!isNearA4Landscape(page)) {
        nonA4Pages.push({
          page: idx + 1,
          width: page.width,
          height: page.height
        });
      }
    });
    if (nonA4Pages.length > 0) {
      findings.push({
        code: 'PAGE_SIZE_NOT_A4',
        message: 'PDF page size is not A4 landscape on some pages.',
        pages: nonA4Pages
      });
    }

    const blankPages = [];
    const sparsePages = [];
    pages.forEach((page, idx) => {
      const compact = normalize(page.text);
      if (!compact) {
        blankPages.push(idx + 1);
        return;
      }
      // Sparse text check is limited to narrative pages; table/front-matter pages are exempt.
      if (compact.length < MIN_CHAR_COUNT_FOR_NON_BLANK && isNarrativePageForSparseCheck(page.text)) {
        sparsePages.push({
          page: idx + 1,
          chars: compact.length,
          sample: String(page.text || '').trim().slice(0, 80)
        });
      }
    });

    if (blankPages.length > MAX_BLANK_PAGE_COUNT) {
      findings.push({
        code: 'TOO_MANY_BLANK_PAGES',
        message: `Too many blank pages: ${blankPages.length}.`,
        pages: blankPages
      });
    }

    if (sparsePages.length > 0) {
      findings.push({
        code: 'SPARSE_PAGES',
        message: 'Pages with too little textual content were detected.',
        pages: sparsePages
      });
    }

    const fullText = normalize(textData.text);
    const missingTerms = REQUIRED_TERMS.filter((item) => !fullText.includes(normalize(item.text)));
    if (missingTerms.length > 0) {
      findings.push({
        code: 'MISSING_REQUIRED_SECTIONS',
        message: 'Some required sections/tables are missing in PDF text.',
        missing: missingTerms.map((item) => item.text)
      });
    }

    const contentPageNumbers = [];
    pages.forEach((page, idx) => {
      if (normalize(page.text)) {
        contentPageNumbers.push(idx + 1);
      }
    });

    const interiorBlankPages = [];
    if (contentPageNumbers.length > 1) {
      const minContentPage = contentPageNumbers[0];
      const maxContentPage = contentPageNumbers[contentPageNumbers.length - 1];
      for (let pageNo = minContentPage + 1; pageNo < maxContentPage; pageNo += 1) {
        if (!normalize(pages[pageNo - 1].text)) {
          interiorBlankPages.push(pageNo);
        }
      }
    }
    if (interiorBlankPages.length > MAX_INTERIOR_BLANK_PAGE_COUNT) {
      findings.push({
        code: 'INTERIOR_BLANK_PAGES',
        message: 'Blank pages were detected between content pages.',
        pages: interiorBlankPages
      });
    }

    const report = {
      pageCount: pages.length,
      blankPages,
      sparsePages,
      findings
    };

    if (findings.length > 0) {
      throw new AppError({
        statusCode: 422,
        code: 'PDF_PREFLIGHT_FAILED',
        message: 'PDF preflight check failed. Please adjust layout/content and regenerate.',
        details: report
      });
    }

    return report;
  } finally {
    await parser.destroy();
  }
};

module.exports = {
  validatePdfOutput
};
