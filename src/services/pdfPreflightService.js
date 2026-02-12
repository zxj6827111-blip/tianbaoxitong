const fs = require('node:fs/promises');
const { PDFParse } = require('pdf-parse');
const { AppError } = require('../errors');

const A4_LANDSCAPE = { width: 841.68, height: 595.44 };
const SIZE_TOLERANCE = 1.2;
const MAX_BLANK_PAGE_COUNT = 1;
const MIN_CHAR_COUNT_FOR_NON_BLANK = 24;

const REQUIRED_TERMS = [
  { key: 'section_7_project_expense', text: '七、项目经费情况说明' },
  { key: 'section_6_other_notes', text: '六、其他相关情况说明' },
  { key: 'table_gov_fund', text: '政府性基金预算支出功能分类预算表' },
  { key: 'table_state_capital', text: '国有资本经营预算支出功能分类预算表' },
  { key: 'table_three_public', text: '“三公”经费和机关运行经费预算表' }
];

const normalize = (text) => String(text || '').replace(/\s+/g, '');

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
      if (compact.length < MIN_CHAR_COUNT_FOR_NON_BLANK) {
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
    if (interiorBlankPages.length > 0) {
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
