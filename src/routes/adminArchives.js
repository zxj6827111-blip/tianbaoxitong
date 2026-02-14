const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const db = require('../db');
const { resolveHistoryActualKey } = require('../services/historyFactMatcher');
const { extractHistoryFactsFromTableData } = require('../services/historyFactAutoExtractor');

const router = express.Router();

const PAGE_MARKER_REGEX = /--\s*\d+\s*of\s*\d+\s*--/g;

const normalizeLine = (line) => line.replace(/\s+/g, ' ').trim();
const normalizeForMatch = (line) => line.replace(/\s+/g, '').trim();

const detectHeading = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const rules = [
    { category: 'FUNCTION', keyword: '主要职能', maxLen: 60 },
    { category: 'STRUCTURE', keyword: '机构设置', maxLen: 60 },
    { category: 'TERMINOLOGY', keyword: '名词解释', maxLen: 40 },
    { category: 'EXPLANATION', keyword: '预算编制说明', maxLen: 80 },
    { category: 'OTHER', keyword: '其他相关情况说明', maxLen: 80 }
  ];

  for (const rule of rules) {
    if (trimmed.includes(rule.keyword) && trimmed.length <= rule.maxLen) {
      return rule;
    }
  }

  return null;
};

const extractSectionsFromText = (text) => {
  const cleaned = text.replace(PAGE_MARKER_REGEX, '');
  const lines = cleaned.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const sections = {};
  let currentCategory = null;

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      currentCategory = heading.category;
      if (!sections[currentCategory]) sections[currentCategory] = [];
      const remainder = line.replace(heading.keyword, '').trim();
      if (remainder) sections[currentCategory].push(remainder);
      continue;
    }

    if (currentCategory) {
      sections[currentCategory].push(line);
    }
  }

  const result = {};
  Object.entries(sections).forEach(([category, contentLines]) => {
    const content = contentLines.join('\n').trim();
    if (content) result[category] = content;
  });

  return result;
};

const sanitizeReusableText = (content) => {
  if (!content) return '';
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^目录$/.test(line))
    .filter((line) => !/^[一二三四五六七八九十0-9]+[、.．].*[\.。．·…]{6,}\s*$/.test(line))
    .filter((line) => !/^[\.。．·…\-\s]+$/.test(line));
  return lines.join('\n').trim();
};

/**
 * Split the EXPLANATION section into structured sub-sections:
 * - EXPLANATION_OVERVIEW: revenue/expenditure summary with year-over-year comparison figures
 * - EXPLANATION_CHANGE_REASON: sentence(s) stating the main reason for changes
 * - EXPLANATION_FISCAL_DETAIL: numbered list of fiscal expenditure items and their purposes
 */
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

  // EXPLANATION_OVERVIEW = everything before the reason line (revenue/expenditure summary)
  const overviewEnd = reasonLineIdx >= 0
    ? reasonLineIdx
    : detailStartIdx >= 0 ? detailStartIdx : -1;
  if (overviewEnd > 0) {
    const overview = lines.slice(0, overviewEnd).join('\n').trim();
    if (overview) result.EXPLANATION_OVERVIEW = overview;
  }

  // EXPLANATION_CHANGE_REASON = the line(s) containing the main reason
  if (reasonLineIdx >= 0) {
    const reasonEnd = detailStartIdx >= 0 ? detailStartIdx : reasonLineIdx + 1;
    const reasonText = lines.slice(reasonLineIdx, reasonEnd).join('\n').trim();
    if (reasonText) result.EXPLANATION_CHANGE_REASON = reasonText;
  }

  // EXPLANATION_FISCAL_DETAIL = from "财政拨款支出主要内容" to end
  if (detailStartIdx >= 0) {
    const detailText = lines.slice(detailStartIdx).join('\n').trim();
    if (detailText) result.EXPLANATION_FISCAL_DETAIL = detailText;
  }

  return result;
};

/**
 * Extract the three-public-expenses sub-section from the OTHER section.
 * Contains year-over-year comparison data and reasons for each expense category.
 */
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

const detectTableKey = (lines) => {
  const normalizedLines = lines.map(normalizeForMatch);
  const has = (keyword) => normalizedLines.some((line) => line.includes(keyword));
  const findTitle = (keyword) => {
    const match = lines.find((line) => normalizeForMatch(line).includes(keyword));
    return match || null;
  };

  const titleRules = [
    { key: 'budget_summary', keyword: '财务收支预算总表' },
    { key: 'income_summary', keyword: '收入预算总表' },
    { key: 'expenditure_summary', keyword: '支出预算总表' },
    { key: 'fiscal_grant_summary', keyword: '财政拨款收支预算总表' },
    { key: 'general_budget', keyword: '一般公共预算支出功能分类预算表' },
    { key: 'gov_fund_budget', keyword: '政府性基金预算支出功能分类预算表' },
    { key: 'capital_budget', keyword: '国有资本经营预算支出功能分类预算表' },
    { key: 'basic_expenditure', keyword: '一般公共预算基本支出部门预算经济分类预算表' },
    { key: 'three_public', keyword: '三公' }
  ];

  for (const rule of titleRules) {
    if (has(rule.keyword)) {
      return { key: rule.key, title: findTitle(rule.keyword) };
    }
  }

  const rules = [
    { key: 'budget_summary', title: '预算单位财务收支预算总表', keywords: ['本年收入', '本年支出'] },
    { key: 'income_summary', title: '预算单位收入预算总表', keywords: ['收入预算', '功能分类科目名称'] },
    { key: 'expenditure_summary', title: '预算单位支出预算总表', keywords: ['支出预算', '功能分类科目名称'] },
    { key: 'fiscal_grant_summary', title: '预算单位财政拨款收支预算总表', keywords: ['财政拨款收入', '财政拨款支出'] },
    { key: 'general_budget', title: '一般公共预算支出功能分类预算表', keywords: ['一般公共预算支出', '功能分类科目名称'] },
    { key: 'gov_fund_budget', title: '政府性基金预算支出功能分类预算表', keywords: ['政府性基金预算支出'] },
    { key: 'capital_budget', title: '国有资本经营预算支出功能分类预算表', keywords: ['国有资本经营预算支出'] },
    { key: 'basic_expenditure', title: '一般公共预算基本支出经济分类预算表', keywords: ['经济分类科目名称', '一般公共预算基本支出'] },
    { key: 'three_public', title: '“三公”经费和机关运行费预算表', keywords: ['三公', '机关运行'] }
  ];

  for (const rule of rules) {
    if (rule.keywords.every((keyword) => has(keyword))) {
      return rule;
    }
  }

  return { key: 'unknown', title: null };
};

const extractTablesFromText = (text) => {
  const pages = text.split(PAGE_MARKER_REGEX);
  const tablesByKey = new Map();

  pages.forEach((pageText, idx) => {
    const lines = pageText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const tableLines = lines.filter((line) => line.includes('\t'));
    if (tableLines.length < 3) return;

    const { key, title } = detectTableKey(lines);
    const rows = tableLines.map((line) => {
      const cells = line.split('\t').map((cell) => cell.trim());
      let lastIndex = cells.length - 1;
      while (lastIndex >= 0 && cells[lastIndex] === '') {
        lastIndex -= 1;
      }
      return cells.slice(0, lastIndex + 1);
    });

    const targetKey = key === 'unknown' ? `unknown_page_${idx + 1}` : key;
    const existing = tablesByKey.get(targetKey) || {
      table_key: targetKey,
      table_title: title,
      page_numbers: [],
      rows: []
    };

    existing.page_numbers.push(idx + 1);
    existing.rows.push(...rows);
    tablesByKey.set(targetKey, existing);
  });

  return Array.from(tablesByKey.values()).map((table) => {
    const colCount = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      table_key: table.table_key,
      table_title: table.table_title,
      page_numbers: table.page_numbers,
      row_count: table.rows.length,
      col_count: colCount,
      rows: table.rows
    };
  });
};

const VALUE_COLUMNS_BY_TABLE = {
  income_summary: ['total', 'fiscal', 'business', 'operation', 'other'],
  expenditure_summary: ['total', 'basic', 'project'],
  general_budget: ['total', 'basic', 'project'],
  gov_fund_budget: ['total', 'basic', 'project'],
  capital_budget: ['total', 'basic', 'project'],
  basic_expenditure: ['total', 'personnel', 'public']
};

const parseNumeric = (value) => {
  if (!value) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const NUMERIC_COMPARE_TOLERANCE = 0.01;
const valuesNearlyEqual = (left, right, tolerance = NUMERIC_COMPARE_TOLERANCE) => {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= tolerance;
};

const isLikelyUnitScaleMismatch = (autoValue, manualValue) => {
  if (!Number.isFinite(autoValue) || !Number.isFinite(manualValue) || autoValue === 0) return false;
  const ratio = Math.abs(manualValue / autoValue);
  return Math.abs(ratio - 10000) <= 1 || Math.abs(ratio - 0.0001) <= 0.000001;
};

const roundToFactPrecision = (value) => {
  if (!Number.isFinite(value)) return value;
  return Number(Number(value).toFixed(2));
};

const MANUAL_VALUE_AMBIGUOUS_YUAN_THRESHOLD = 10000000;
const MANUAL_SCALE_ANCHOR_MAP = {
  budget_revenue_fiscal: 'fiscal_grant_revenue_total',
  fiscal_grant_revenue_total: 'budget_revenue_fiscal',
  budget_expenditure_total: 'fiscal_grant_expenditure_total',
  fiscal_grant_expenditure_total: 'budget_expenditure_total'
};
const SMALL_AMOUNT_FACT_KEYS = new Set([
  'three_public_total',
  'three_public_outbound',
  'three_public_vehicle_total',
  'three_public_vehicle_purchase',
  'three_public_vehicle_operation',
  'three_public_reception',
  'operation_fund'
]);

const inferManualScaleToWanyuan = (rawLabel, numeric) => {
  const text = String(rawLabel || '').replace(/\s+/g, '');
  if (!text) {
    return Math.abs(numeric) >= MANUAL_VALUE_AMBIGUOUS_YUAN_THRESHOLD ? 1 / 10000 : 1;
  }

  if (text.includes('万元')) return 1;
  if (text.includes('千元')) return 0.1;
  if (text.includes('单位：元') || text.includes('单位:元')) return 1 / 10000;
  if (text.includes('元') && !text.includes('美元')) return 1 / 10000;
  if (Math.abs(numeric) >= MANUAL_VALUE_AMBIGUOUS_YUAN_THRESHOLD) return 1 / 10000;
  return 1;
};

const normalizeManualFactValue = ({ rawLabel, matchedKey, numeric, mappedEntries }) => {
  const anchorKey = MANUAL_SCALE_ANCHOR_MAP[matchedKey];
  if (anchorKey) {
    const anchor = Number(mappedEntries.get(anchorKey));
    if (Number.isFinite(anchor) && anchor !== 0 && isLikelyUnitScaleMismatch(anchor, numeric)) {
      const ratio = Math.abs(numeric / anchor);
      const normalized = ratio >= 1 ? numeric / 10000 : numeric * 10000;
      return {
        value: roundToFactPrecision(normalized),
        normalized: true,
        reason: 'ANCHOR_SCALE_NORMALIZED'
      };
    }
  }

  const scale = inferManualScaleToWanyuan(rawLabel, numeric);
  if (scale !== 1) {
    return {
      value: roundToFactPrecision(numeric * scale),
      normalized: true,
      reason: 'LABEL_OR_MAGNITUDE_SCALE_NORMALIZED'
    };
  }

  // Guardrail: three-public and operation-fund values are in "万元" and are usually small.
  // If manual parse yields huge numbers (often "元"), normalize to "万元".
  if (SMALL_AMOUNT_FACT_KEYS.has(matchedKey) && Math.abs(numeric) >= 1000) {
    return {
      value: roundToFactPrecision(numeric / 10000),
      normalized: true,
      reason: 'SMALL_AMOUNT_KEY_SCALE_NORMALIZED'
    };
  }

  return {
    value: roundToFactPrecision(numeric),
    normalized: false,
    reason: null
  };
};

const extractLineItemsFromTables = (tables) => {
  const items = [];

  tables.forEach((table) => {
    const columnKeys = VALUE_COLUMNS_BY_TABLE[table.table_key] || null;

    const rows = Array.isArray(table.rows) ? table.rows : [];
    rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length === 0) return;

      let idx = 0;
      const codes = [];

      while (idx < row.length && codes.length < 3) {
        const cell = row[idx] ? String(row[idx]).trim() : '';
        if (!cell) {
          idx += 1;
          continue;
        }
        if (/^\d+$/.test(cell)) {
          codes.push(cell);
          idx += 1;
          continue;
        }
        break;
      }

      if (codes.length === 0) return;

      const nameCell = row[idx] ? String(row[idx]).trim() : '';
      if (!nameCell || /^\d+$/.test(nameCell)) return;

      idx += 1;
      const valueCells = row.slice(idx);
      const values = valueCells.map((cell) => parseNumeric(cell));

      const valuesJson = {};
      values.forEach((val, valIndex) => {
        if (val === null) return;
        const key = columnKeys
          ? (columnKeys[valIndex] || `extra_${valIndex + 1}`)
          : `col_${valIndex + 1}`;
        valuesJson[key] = val;
      });

      if (Object.keys(valuesJson).length === 0) return;

      items.push({
        table_key: table.table_key,
        row_index: rowIndex,
        class_code: codes[0] || null,
        type_code: codes[1] || null,
        item_code: codes[2] || null,
        item_name: nameCell,
        values_json: valuesJson
      });
    });
  });

  return items;
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // USE ABSOLUTE PATH TO BE SAFE
    const uploadDir = path.join(process.cwd(), 'uploads/archives');
    console.log('Upload: resolving destination:', uploadDir);
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      console.log('Upload: directory ensuring success');
      cb(null, uploadDir);
    } catch (error) {
      console.error('Upload: directory creation failed:', error);
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    console.log('Upload: processing file:', file.originalname);
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      console.error('Upload: Invalid file type');
      return cb(new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only PDF files are allowed'
      }));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Upload Annual Report PDF
router.post('/upload', requireAuth, requireRole(['admin', 'maintainer']), upload.single('file'), async (req, res, next) => {
  console.log('Upload: Route handler reached');
  console.log('Upload: Request body:', req.body);
  console.log('Upload: Request file:', req.file);

  const client = await db.getClient();
  try {
    if (!req.file) {
      throw new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'PDF file is required'
      });
    }

    const { department_id, year } = req.body;
    const reportTypeRaw = req.body.report_type;
    const report_type = String(reportTypeRaw || '').toUpperCase();

    if (!department_id || !year || !report_type) {
      console.error('Upload: Missing fields:', { department_id, year, report_type });
      // Clean up uploaded file
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'department_id, year, and report_type are required'
      });
    }

    if (!['BUDGET', 'FINAL'].includes(report_type)) {
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_type must be BUDGET or FINAL'
      });
    }

    // Calculate file hash
    const fileBuffer = await fs.readFile(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    await client.query('BEGIN');

    // Fix filename encoding (often issues with multer handling non-ASCII on Windows)
    let originalName = req.file.originalname;
    try {
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      console.warn('Filename decoding failed, using original:', e);
    }

    // Insert report metadata
    const reportResult = await client.query(
      `INSERT INTO org_dept_annual_report 
       (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (department_id, year, report_type)
       DO UPDATE SET 
         file_name = EXCLUDED.file_name,
         file_path = EXCLUDED.file_path,
         file_hash = EXCLUDED.file_hash,
         file_size = EXCLUDED.file_size,
         uploaded_by = EXCLUDED.uploaded_by,
         updated_at = NOW()
       RETURNING *`,
      [
        department_id,
        parseInt(year),
        report_type,
        originalName,
        req.file.path,
        fileHash,
        req.file.size,
        req.user.id
      ]
    );

    const report = reportResult.rows[0];

    // Extract text from PDF
    let extractedText = '';
    try {
      const parser = new PDFParse({ data: fileBuffer });
      const pdfData = await parser.getText({
        cellSeparator: '\t',
        lineEnforce: true,
        pageJoiner: '\n-- page_number of total_number --\n'
      });
      extractedText = pdfData.text || '';
      await parser.destroy();
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      // Continue even if PDF parsing fails
    }

    if (!['BUDGET', 'FINAL'].includes(report_type)) {
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_type must be BUDGET or FINAL'
      });
    }

    let tables = [];
    let lineItems = [];
    if (extractedText) {
      const sections = extractSectionsFromText(extractedText);
      tables = extractTablesFromText(extractedText);
      lineItems = extractLineItemsFromTables(tables);

      const upsertTextContent = async (category, content) => {
        if (!content) return;
        const finalContent = category === 'RAW' ? content : sanitizeReusableText(content);
        if (!finalContent) return;
        await client.query(
          `INSERT INTO org_dept_text_content 
           (department_id, year, report_type, category, content_text, source_report_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (department_id, year, report_type, category)
           DO UPDATE SET 
             content_text = EXCLUDED.content_text,
             source_report_id = EXCLUDED.source_report_id,
             updated_at = NOW()
           WHERE org_dept_text_content.content_text IS NULL
              OR org_dept_text_content.content_text = ''`,
          [department_id, parseInt(year), report_type, category, finalContent, report.id, req.user.id]
        );
      };

      await upsertTextContent('RAW', extractedText);

      const categories = {
        FUNCTION: sections.FUNCTION,
        STRUCTURE: sections.STRUCTURE,
        TERMINOLOGY: sections.TERMINOLOGY,
        EXPLANATION: sections.EXPLANATION,
        OTHER: sections.OTHER
      };

      for (const [category, content] of Object.entries(categories)) {
        await upsertTextContent(category, content);
      }

      // Extract and save structured sub-sections for year-over-year reuse
      const explanationSubs = extractExplanationSubSections(sections.EXPLANATION);
      const otherSubs = extractOtherSubSections(sections.OTHER);
      for (const [subCategory, subContent] of Object.entries({ ...explanationSubs, ...otherSubs })) {
        await upsertTextContent(subCategory, subContent);
      }

      if (tables.length > 0) {
        await client.query('DELETE FROM org_dept_table_data WHERE report_id = $1', [report.id]);
      }

      for (const table of tables) {
        await client.query(
          `INSERT INTO org_dept_table_data
           (report_id, department_id, year, report_type, table_key, table_title, page_numbers, row_count, col_count, data_json, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (report_id, table_key)
           DO UPDATE SET
             table_title = EXCLUDED.table_title,
             page_numbers = EXCLUDED.page_numbers,
             row_count = EXCLUDED.row_count,
             col_count = EXCLUDED.col_count,
             data_json = EXCLUDED.data_json,
             updated_at = NOW()`,
          [
            report.id,
            department_id,
            parseInt(year),
            report_type,
            table.table_key,
            table.table_title,
            table.page_numbers,
            table.row_count,
            table.col_count,
            JSON.stringify(table.rows),
            req.user.id
          ]
        );
      }

      if (lineItems.length > 0) {
        await client.query('DELETE FROM org_dept_line_items WHERE report_id = $1', [report.id]);
      }

      for (const item of lineItems) {
        await client.query(
          `INSERT INTO org_dept_line_items
           (report_id, department_id, year, report_type, table_key, row_index, class_code, type_code, item_code, item_name, values_json, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (report_id, table_key, row_index)
           DO UPDATE SET
             class_code = EXCLUDED.class_code,
             type_code = EXCLUDED.type_code,
             item_code = EXCLUDED.item_code,
             item_name = EXCLUDED.item_name,
             values_json = EXCLUDED.values_json,
             updated_at = NOW()`,
          [
            report.id,
            department_id,
            parseInt(year),
            report_type,
            item.table_key,
            item.row_index,
            item.class_code,
            item.type_code,
            item.item_code,
            item.item_name,
            JSON.stringify(item.values_json),
            req.user.id
          ]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      report,
      extracted_text_length: extractedText.length,
      table_count: tables.length,
      line_item_count: lineItems.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload: Error processing request:', error);
    // Clean up file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    return next(error);
  } finally {
    client.release();
  }
});

// Get Archives for Department/Year
router.get('/departments/:deptId/years', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { deptId } = req.params;
    const yearsResult = await db.query(
      `SELECT DISTINCT year
       FROM org_dept_annual_report
       WHERE department_id = $1
       ORDER BY year DESC`,
      [deptId]
    );

    return res.json({
      years: yearsResult.rows.map((row) => Number(row.year)).filter((value) => Number.isInteger(value))
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/departments/:deptId/years/:year', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { deptId, year } = req.params;
    const unitId = req.query.unit_id ? String(req.query.unit_id) : null;
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'year must be a valid integer'
      });
    }

    await client.query('BEGIN');

    const reportRows = await client.query(
      `SELECT id, file_path
       FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );
    const filePaths = reportRows.rows.map((row) => row.file_path).filter(Boolean);

    const textDeleteResult = await client.query(
      `DELETE FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    const tableDeleteResult = await client.query(
      `DELETE FROM org_dept_table_data
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    const lineDeleteResult = await client.query(
      `DELETE FROM org_dept_line_items
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    const reportDeleteResult = await client.query(
      `DELETE FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2`,
      [deptId, parsedYear]
    );

    let historyDeleteCount = 0;
    if (unitId) {
      const historyDeleteResult = await client.query(
        `DELETE FROM history_actuals
         WHERE unit_id = $1
           AND year = $2
           AND stage = 'FINAL'
           AND provenance_source = 'archive_parse'`,
        [unitId, parsedYear]
      );
      historyDeleteCount = historyDeleteResult.rowCount;
    }

    await client.query('COMMIT');

    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        console.warn('Delete year: failed to remove file:', filePath, unlinkError?.message || unlinkError);
      }
    }

    return res.json({
      success: true,
      department_id: deptId,
      year: parsedYear,
      deleted: {
        reports: reportDeleteResult.rowCount,
        text_content: textDeleteResult.rowCount,
        table_data: tableDeleteResult.rowCount,
        line_items: lineDeleteResult.rowCount,
        history_actuals_archive_parse: historyDeleteCount
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/departments/:deptId/years/:year', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { deptId, year } = req.params;
    const reportType = req.query.report_type ? String(req.query.report_type).toUpperCase() : null;
    const reportTypeFilter = reportType && ['BUDGET', 'FINAL'].includes(reportType) ? reportType : null;

    // Get reports
    const reportsResult = await db.query(
      `SELECT * FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2
       ORDER BY report_type`,
      [deptId, parseInt(year)]
    );

    // Get text content
    const textResult = await db.query(
      `SELECT * FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2
         AND ($3::text IS NULL OR report_type = $3)
       ORDER BY category`,
      [deptId, parseInt(year), reportTypeFilter]
    );

    const tableResult = await db.query(
      `SELECT *
       FROM org_dept_table_data
       WHERE department_id = $1 AND year = $2
         AND ($3::text IS NULL OR report_type = $3)
       ORDER BY table_key`,
      [deptId, parseInt(year), reportTypeFilter]
    );

    const lineItemResult = await db.query(
      `SELECT *
       FROM org_dept_line_items
       WHERE department_id = $1 AND year = $2
         AND ($3::text IS NULL OR report_type = $3)
       ORDER BY table_key, row_index`,
      [deptId, parseInt(year), reportTypeFilter]
    );

    return res.json({
      reports: reportsResult.rows,
      text_content: textResult.rows,
      table_data: tableResult.rows,
      line_items: lineItemResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

// Save/Update Text Content
router.post('/text-content', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { department_id, year, category, content_text } = req.body;
    const report_type = String(req.body?.report_type || 'BUDGET').toUpperCase();

    if (!department_id || !year || !category || !content_text) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'department_id, year, category, and content_text are required'
      });
    }

    if (!['BUDGET', 'FINAL'].includes(report_type)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_type must be BUDGET or FINAL'
      });
    }

    const result = await db.query(
      `INSERT INTO org_dept_text_content 
       (department_id, year, report_type, category, content_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (department_id, year, report_type, category)
       DO UPDATE SET 
         content_text = EXCLUDED.content_text,
         updated_at = NOW()
       RETURNING *`,
      [department_id, parseInt(year), report_type, category, content_text, req.user.id]
    );

    return res.json({ text_content: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Get Text Content by Category (for reuse in Workbench)
router.get('/text-content/:deptId/:year/:category', requireAuth, async (req, res, next) => {
  try {
    const { deptId, year, category } = req.params;
    const report_type = String(req.query.report_type || 'BUDGET').toUpperCase();

    const result = await db.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2 AND report_type = $3 AND category = $4`,
      [deptId, parseInt(year), report_type, category]
    );

    if (result.rows.length === 0) {
      return res.json({ content_text: null });
    }

    return res.json({ content_text: result.rows[0].content_text });
  } catch (error) {
    return next(error);
  }
});

// --- Parsing & Extraction Endpoints ---

// Local Regex Parser
router.post('/parse-budget-table', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { report_id } = req.body;

    // 1. Get RAW text
    const textResult = await db.query(
      `SELECT content_text FROM org_dept_text_content 
       WHERE source_report_id = $1 AND category = 'RAW'`,
      [report_id]
    );

    if (textResult.rows.length === 0) {
      return res.json({ items: [] });
    }

    const rawText = textResult.rows[0].content_text;
    const lines = rawText.split('\n');
    const items = [];

    // 2. Simple Heuristic Regex
    // Line looks like: "Administrative Expenses ... 1,234.56"
    // Regex: Start with non-digit, end with number (allowing for whitespace and dots)
    const regex = /^(.+?)\s+([-+]?[\d,]+\.?\d*)$/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(regex);
      if (match) {
        let key = match[1].trim();
        let valueStr = match[2].replace(/,/g, ''); // Remove commas
        let value = parseFloat(valueStr);

        // Filter out obvious noise (e.g. page numbers, dates)
        if (!isNaN(value) && key.length > 2 && key.length < 50) {
          items.push({ key, value });
        }
      }
    }

    if (items.length === 0) {
      return res.json({ items: [], warning: 'NO_MATCHES_FOUND' });
    }

    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

// AI Parser (Generic OpenAI-compatible)
router.post('/parse-budget-table-ai', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { report_id, model_config } = req.body;
    const { provider, apiKey, model, baseUrl } = model_config || {};

    if (!apiKey) {
      throw new AppError({ statusCode: 400, message: 'API Key is required' });
    }

    // 1. Get RAW text
    const textResult = await db.query(
      `SELECT content_text FROM org_dept_text_content 
       WHERE source_report_id = $1 AND category = 'RAW'`,
      [report_id]
    );

    if (textResult.rows.length === 0 || !textResult.rows[0].content_text.trim()) {
      return res.json({ items: [], error: 'NO_SOURCE_TEXT' });
    }

    const rawText = textResult.rows[0].content_text.substring(0, 15000); // Limit context to avoid hitting limits

    // 2. Construct AI Query
    const systemPrompt = `You are a financial data extraction assistant. Extract budget line items from the provided text.
Return ONLY a JSON array of objects with 'key' (item name) and 'value' (number). 
Ignore headers, footers, and page numbers.
Example: [{"key": "Total Income", "value": 10000.00}]`;

    const userPrompt = `Extract budget items from this text:\n\n${rawText}`;

    // 3. Call External API (OpenAI Compatible)
    // Default URL for generic OpenAI use, but allows override (e.g. for local models or specific providers)
    const apiUrl = baseUrl || 'https://api.openai.com/v1/chat/completions';

    // Normalize model name if needed (some providers map model names differently)
    const targetModel = model || 'gpt-3.5-turbo';

    console.log(`AI Parse: Calling ${apiUrl} with model ${targetModel}`);

    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" } // Try to enforce JSON
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API Error:', errText);
      throw new AppError({ statusCode: 502, message: `AI API Failed: ${aiResponse.statusText}` });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices[0].message.content;

    // Parse JSON from content
    let parsedItems = [];
    try {
      // Handle case where model wraps JSON in markdown blocks
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/) || [content];
      const jsonStr = jsonMatch.length > 1 ? jsonMatch[1] : jsonMatch[0];

      const result = JSON.parse(jsonStr);
      // Supports flexible return format (array or object wrapper)
      parsedItems = Array.isArray(result) ? result : (result.items || result.data || []);
    } catch (e) {
      console.error('AI JSON Parse Error:', e, content);
      throw new AppError({ statusCode: 500, message: 'Failed to parse AI response' });
    }

    return res.json({ items: parsedItems });

  } catch (error) {
    return next(error);
  }
});

// Save Extracted Facts
router.post('/save-budget-facts', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { report_id, unit_id, items } = req.body;

    if (!report_id || !Array.isArray(items)) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'report_id and items[] are required'
      });
    }

    const reportRes = await client.query('SELECT * FROM org_dept_annual_report WHERE id = $1', [report_id]);
    if (reportRes.rows.length === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Report not found'
      });
    }
    const report = reportRes.rows[0];

    let targetUnitId = unit_id || null;
    if (targetUnitId) {
      const unitCheck = await client.query(
        `SELECT id
         FROM org_unit
         WHERE id = $1
           AND department_id = $2`,
        [targetUnitId, report.department_id]
      );
      if (unitCheck.rowCount === 0) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'unit_id does not belong to report department'
        });
      }
    } else {
      const fallbackUnit = await client.query(
        `SELECT id
         FROM org_unit
         WHERE department_id = $1
         ORDER BY sort_order ASC, created_at ASC
         LIMIT 1`,
        [report.department_id]
      );
      if (fallbackUnit.rowCount === 0) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'No unit found for report department'
        });
      }
      targetUnitId = fallbackUnit.rows[0].id;
    }

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO org_dept_text_content 
         (department_id, year, report_type, category, content_text, source_report_id, created_by)
         VALUES ($1, $2, $3, 'DATA_JSON', $4, $5, $6)
         ON CONFLICT (department_id, year, report_type, category)
         DO UPDATE SET 
           content_text = EXCLUDED.content_text,
           source_report_id = EXCLUDED.source_report_id,
           updated_at = NOW()`,
      [report.department_id, report.year, report.report_type, JSON.stringify(items), report_id, req.user.id]
    );

    const tableDataRes = await client.query(
      `SELECT table_key, data_json
       FROM org_dept_table_data
       WHERE report_id = $1`,
      [report_id]
    );
    const autoFacts = extractHistoryFactsFromTableData(tableDataRes.rows || []);

    const mappedEntries = new Map(Object.entries(autoFacts));
    const autoFactKeys = new Set(Object.keys(autoFacts));
    const manualConflicts = [];
    const manualScaled = [];
    const unmatched = [];

    for (const item of items) {
      const rawLabel = String(item?.key || '').trim();
      const numeric = Number(item?.value);
      if (!rawLabel || !Number.isFinite(numeric)) {
        continue;
      }

      const matchedKey = resolveHistoryActualKey(rawLabel);
      if (!matchedKey) {
        unmatched.push(rawLabel);
        continue;
      }

      // Structured table extraction is the most reliable source.
      // Manual parse values are only used to fill missing keys, not override auto facts.
      if (autoFactKeys.has(matchedKey)) {
        const autoValue = Number(mappedEntries.get(matchedKey));
        if (!valuesNearlyEqual(autoValue, numeric)) {
          manualConflicts.push({
            key: matchedKey,
            auto_value: autoValue,
            manual_value: numeric,
            reason: isLikelyUnitScaleMismatch(autoValue, numeric)
              ? 'UNIT_SCALE_MISMATCH'
              : 'AUTO_FACT_PROTECTED'
          });
        }
        continue;
      }

      const normalizedManual = normalizeManualFactValue({
        rawLabel,
        matchedKey,
        numeric,
        mappedEntries
      });

      mappedEntries.set(matchedKey, normalizedManual.value);

      if (normalizedManual.normalized && !valuesNearlyEqual(normalizedManual.value, numeric)) {
        manualScaled.push({
          key: matchedKey,
          original_manual_value: numeric,
          normalized_value: normalizedManual.value,
          reason: normalizedManual.reason
        });
      }
    }

    let upsertedCount = 0;
    const mappedKeys = Array.from(mappedEntries.keys());
    let lockedKeys = new Set();

    if (mappedKeys.length > 0) {
      const lockedResult = await client.query(
        `SELECT key
         FROM history_actuals
         WHERE unit_id = $1
           AND year = $2
           AND stage = 'FINAL'
           AND is_locked = true
           AND key = ANY($3)`,
        [targetUnitId, report.year, mappedKeys]
      );
      lockedKeys = new Set(lockedResult.rows.map((row) => row.key));
    }

    for (const [factKey, factValue] of mappedEntries.entries()) {
      if (lockedKeys.has(factKey)) continue;

      const upsertResult = await client.query(
        `INSERT INTO history_actuals
           (unit_id, year, stage, key, value_numeric, source_batch_id, is_locked, provenance_source)
         VALUES ($1, $2, 'FINAL', $3, $4, NULL, false, 'archive_parse')
         ON CONFLICT (unit_id, year, stage, key)
         DO UPDATE SET
           value_numeric = EXCLUDED.value_numeric,
           provenance_source = EXCLUDED.provenance_source,
           updated_at = NOW()
         WHERE history_actuals.is_locked = false
         RETURNING key`,
        [targetUnitId, report.year, factKey, factValue]
      );
      upsertedCount += upsertResult.rowCount;
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      unit_id: targetUnitId,
      year: Number(report.year),
      auto_mapped_count: Object.keys(autoFacts).length,
      mapped_count: mappedEntries.size,
      upserted_count: upsertedCount,
      locked_skipped: Array.from(lockedKeys),
      manual_conflict_skipped_count: manualConflicts.length,
      manual_conflicts: manualConflicts.slice(0, 20),
      manual_scaled_count: manualScaled.length,
      manual_scaled: manualScaled.slice(0, 20),
      unmatched_count: unmatched.length,
      unmatched_labels: unmatched.slice(0, 20)
    });

  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
