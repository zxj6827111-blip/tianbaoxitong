const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const OCR_TIMEOUT_MS = Number(process.env.ARCHIVE_OCR_TIMEOUT_MS || 60000);
const DEFAULT_LANG = process.env.ARCHIVE_OCR_LANG || 'chi_sim+eng';
const DEFAULT_PSM = process.env.ARCHIVE_OCR_PSM || '6';
const DEFAULT_PDFTOPPM_BIN = process.env.ARCHIVE_OCR_PDFTOPPM_BIN || 'pdftoppm';
const DEFAULT_TESSERACT_BIN = process.env.ARCHIVE_OCR_TESSERACT_BIN || 'tesseract';

const isOcrEnabled = () => String(process.env.ARCHIVE_OCR_ENABLED || 'true').toLowerCase() !== 'false';

const normalizePageNumbers = (pagesInput) => {
  return Array.from(
    new Set(
      (Array.isArray(pagesInput) ? pagesInput : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((a, b) => a - b);
};

const commandExists = async (bin) => {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(probe, [bin], {
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch (error) {
    return false;
  }
};

const resolveReadablePath = async (inputPath) => {
  const raw = String(inputPath || '').trim();
  if (!raw) return null;
  const candidates = Array.from(new Set([
    raw,
    path.resolve(process.cwd(), raw)
  ]));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      // keep checking candidates
    }
  }
  return null;
};

const parseMockTableText = () => {
  const text = process.env.ARCHIVE_OCR_MOCK_TEXT_JSON;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const normalized = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key) continue;
      const content = String(value || '').trim();
      if (!content) continue;
      normalized[String(key)] = content;
    }
    return normalized;
  } catch (error) {
    return null;
  }
};

const renderPagePng = async ({ pdfPath, pageNo, outputDir, pdftoppmBin }) => {
  const prefix = path.join(
    outputDir,
    `ocr_${pageNo}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  );
  await execFileAsync(
    pdftoppmBin,
    ['-f', String(pageNo), '-l', String(pageNo), '-png', pdfPath, prefix],
    {
      timeout: OCR_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }
  );
  return `${prefix}-1.png`;
};

const recognizeImageText = async ({ imagePath, tesseractBin, lang, psm }) => {
  const { stdout } = await execFileAsync(
    tesseractBin,
    [imagePath, 'stdout', '-l', lang, '--psm', String(psm)],
    {
      timeout: OCR_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    }
  );
  return String(stdout || '').trim();
};

const runSelectiveOcrForTables = async ({ pdfPath, tables, suspiciousTableKeys }) => {
  const keys = Array.from(new Set(Array.isArray(suspiciousTableKeys) ? suspiciousTableKeys.filter(Boolean) : []));
  if (keys.length === 0) {
    return {
      enabled: isOcrEnabled(),
      executed: false,
      reason: 'NO_SUSPICIOUS_TABLES',
      table_text_by_key: {},
      processed_tables: [],
      skipped_tables: []
    };
  }

  const mockTableText = parseMockTableText();
  if (mockTableText) {
    const tableTextByKey = {};
    const processed = [];
    const skipped = [];
    for (const key of keys) {
      if (mockTableText[key]) {
        tableTextByKey[key] = mockTableText[key];
        processed.push(key);
      } else {
        skipped.push({ table_key: key, reason: 'MOCK_TEXT_NOT_PROVIDED' });
      }
    }
    return {
      enabled: true,
      executed: processed.length > 0,
      reason: processed.length > 0 ? 'MOCK_OCR' : 'MOCK_NO_MATCH',
      table_text_by_key: tableTextByKey,
      processed_tables: processed,
      skipped_tables: skipped,
      mock_mode: true
    };
  }

  if (!isOcrEnabled()) {
    return {
      enabled: false,
      executed: false,
      reason: 'OCR_DISABLED',
      table_text_by_key: {},
      processed_tables: [],
      skipped_tables: keys.map((key) => ({ table_key: key, reason: 'OCR_DISABLED' }))
    };
  }

  const resolvedPdfPath = await resolveReadablePath(pdfPath);
  if (!resolvedPdfPath) {
    return {
      enabled: true,
      executed: false,
      reason: 'PDF_NOT_FOUND',
      table_text_by_key: {},
      processed_tables: [],
      skipped_tables: keys.map((key) => ({ table_key: key, reason: 'PDF_NOT_FOUND' }))
    };
  }

  const [hasPdftoppm, hasTesseract] = await Promise.all([
    commandExists(DEFAULT_PDFTOPPM_BIN),
    commandExists(DEFAULT_TESSERACT_BIN)
  ]);
  if (!hasPdftoppm || !hasTesseract) {
    return {
      enabled: true,
      executed: false,
      reason: 'OCR_BINARY_MISSING',
      table_text_by_key: {},
      processed_tables: [],
      skipped_tables: keys.map((key) => ({ table_key: key, reason: 'OCR_BINARY_MISSING' })),
      binary_status: {
        pdftoppm: hasPdftoppm,
        tesseract: hasTesseract
      }
    };
  }

  const tableRows = Array.isArray(tables) ? tables : [];
  const tableMap = new Map(tableRows.map((table) => [String(table.table_key || ''), table]));
  const tableTextByKey = {};
  const processedTables = [];
  const skippedTables = [];
  const tmpRoot = process.env.ARCHIVE_OCR_TMP_DIR || path.join(os.tmpdir(), 'archive-ocr');
  const workDir = path.join(tmpRoot, `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    for (const key of keys) {
      const table = tableMap.get(key);
      if (!table) {
        skippedTables.push({ table_key: key, reason: 'TABLE_NOT_FOUND' });
        continue;
      }

      const pages = normalizePageNumbers(table.page_numbers);
      if (pages.length === 0) {
        skippedTables.push({ table_key: key, reason: 'NO_PAGE_NUMBERS' });
        continue;
      }

      const texts = [];
      for (const pageNo of pages) {
        let imagePath = null;
        try {
          imagePath = await renderPagePng({
            pdfPath: resolvedPdfPath,
            pageNo,
            outputDir: workDir,
            pdftoppmBin: DEFAULT_PDFTOPPM_BIN
          });
          const pageText = await recognizeImageText({
            imagePath,
            tesseractBin: DEFAULT_TESSERACT_BIN,
            lang: DEFAULT_LANG,
            psm: DEFAULT_PSM
          });
          if (pageText) texts.push(pageText);
        } catch (error) {
          skippedTables.push({
            table_key: key,
            page_no: pageNo,
            reason: 'OCR_PAGE_FAILED',
            detail: error.message
          });
        } finally {
          if (imagePath) {
            await fs.unlink(imagePath).catch(() => {});
          }
        }
      }

      const mergedText = texts.join('\n').trim();
      if (!mergedText) {
        skippedTables.push({ table_key: key, reason: 'EMPTY_OCR_TEXT' });
        continue;
      }

      tableTextByKey[key] = mergedText;
      processedTables.push(key);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    enabled: true,
    executed: processedTables.length > 0,
    reason: processedTables.length > 0 ? 'OCR_APPLIED' : 'OCR_NO_OUTPUT',
    table_text_by_key: tableTextByKey,
    processed_tables: processedTables,
    skipped_tables: skippedTables,
    mock_mode: false
  };
};

module.exports = {
  runSelectiveOcrForTables
};

