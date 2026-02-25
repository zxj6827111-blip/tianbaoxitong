const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PDFParse } = require('pdf-parse');
const { sanitizeArchiveTextByCategory } = require('./manualTextSanitizer');

const PAGE_MARKER_REGEX = /(?:--\s*PAGE_BREAK\s*--|--\s*\d+\s*of\s*\d+\s*--|--\s*page_number\s*of\s*total_number\s*--)/gi;
const ARCHIVE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'archives');
const ARCHIVE_SCOPE = {
  UNIT: 'unit',
  DEPARTMENT: 'department'
};
let archiveTableParser = null;

const normalizeLine = (line) => String(line || '').replace(/\s+/g, ' ').trim();
const normalizeReportType = (reportType, fileName) => {
  const explicit = String(reportType || '').toUpperCase();
  if (['BUDGET', 'FINAL'].includes(explicit)) return explicit;
  const filenameText = String(fileName || '');
  if (/决算|final/i.test(filenameText)) return 'FINAL';
  return 'BUDGET';
};

const normalizeArchiveScope = (scope) => (
  String(scope || '').toLowerCase() === ARCHIVE_SCOPE.DEPARTMENT
    ? ARCHIVE_SCOPE.DEPARTMENT
    : ARCHIVE_SCOPE.UNIT
);

const detectHeading = (line) => {
  const trimmed = String(line || '').trim();
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
  const cleaned = String(text || '').replace(PAGE_MARKER_REGEX, '');
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

const sanitizeReusableText = (content, category = null) => {
  if (!content) return '';
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^目录$/.test(line))
    .filter((line) => !/^[一二三四五六七八九十〇零0-9]+[、.．].*[\.。…·]{6,}\s*$/.test(line))
    .filter((line) => !/^[\.。…·\-\s]+$/.test(line));
  const normalized = lines.join('\n').trim();
  return sanitizeArchiveTextByCategory(category, normalized);
};

const extractExplanationSubSections = (text) => {
  if (!text) return {};
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const isHeading = /^[一二三四五六七八九十〇零0-9]+[、.．]/.test(lines[i]);
    if (isHeading && lines[i].includes('三公')) {
      startIdx = i;
    } else if (isHeading && startIdx >= 0) {
      endIdx = i;
      break;
    }
  }

  if (startIdx >= 0) {
    const content = lines.slice(startIdx, endIdx).join('\n').trim();
    if (content) {
      return { OTHER_THREE_PUBLIC: content };
    }
  }
  return {};
};

const ensureArchiveUploadDir = async () => {
  await fs.mkdir(ARCHIVE_UPLOAD_DIR, { recursive: true });
};

const buildArchiveStoredPath = (originalName) => {
  const ext = path.extname(String(originalName || '')).toLowerCase() || '.pdf';
  const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  return path.join(ARCHIVE_UPLOAD_DIR, uniqueName);
};

const extractPdfText = async (fileBuffer) => {
  const parser = new PDFParse({ data: fileBuffer });
  try {
    const pdfData = await parser.getText({
      cellSeparator: '\t',
      lineEnforce: true,
      pageJoiner: '\n-- page_number of total_number --\n'
    });
    return String(pdfData?.text || '');
  } finally {
    await parser.destroy();
  }
};

const loadArchiveTableParser = () => {
  if (archiveTableParser) {
    return archiveTableParser;
  }
  const archivesRoute = require('../routes/adminArchives');
  const privateApi = archivesRoute?.__private || {};
  if (
    typeof privateApi.extractTablesFromText !== 'function'
    || typeof privateApi.extractLineItemsFromTables !== 'function'
  ) {
    throw new Error('archive table parser helpers are unavailable');
  }
  archiveTableParser = {
    extractTablesFromText: privateApi.extractTablesFromText,
    extractLineItemsFromTables: privateApi.extractLineItemsFromTables
  };
  return archiveTableParser;
};

const upsertArchiveTextContent = async ({
  client,
  departmentId,
  unitId,
  year,
  reportType,
  category,
  content,
  reportId,
  userId
}) => {
  if (!content) return;
  const finalContent = category === 'RAW'
    ? String(content || '')
    : sanitizeReusableText(content, category);
  if (!finalContent) return;

  await client.query(
    `INSERT INTO org_dept_text_content
       (department_id, unit_id, year, report_type, category, content_text, source_report_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (department_id, unit_id, year, report_type, category)
     DO UPDATE SET
       content_text = EXCLUDED.content_text,
       source_report_id = EXCLUDED.source_report_id,
       updated_at = NOW()`,
    [departmentId, unitId || null, year, reportType, category, finalContent, reportId, userId || null]
  );
};

const normalizePageNumbers = (pages) => {
  return Array.from(
    new Set(
      (Array.isArray(pages) ? pages : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ).sort((a, b) => a - b);
};

const replaceArchiveTableData = async ({
  client,
  reportId,
  departmentId,
  year,
  reportType,
  tables,
  userId
}) => {
  await client.query('DELETE FROM org_dept_table_data WHERE report_id = $1', [reportId]);
  const list = Array.isArray(tables) ? tables : [];

  for (let index = 0; index < list.length; index += 1) {
    const table = list[index] || {};
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const pageNumbers = normalizePageNumbers(table.page_numbers);
    const rowCount = Number.isInteger(Number(table.row_count)) ? Number(table.row_count) : rows.length;
    const colCount = Number.isInteger(Number(table.col_count))
      ? Number(table.col_count)
      : rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const tableKey = String(table.table_key || `unknown_table_${index + 1}`);

    // eslint-disable-next-line no-await-in-loop
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
        reportId,
        departmentId,
        year,
        reportType,
        tableKey,
        table.table_title || null,
        pageNumbers,
        Math.max(0, rowCount),
        Math.max(0, colCount),
        JSON.stringify(rows),
        userId || null
      ]
    );
  }
};

const replaceArchiveLineItems = async ({
  client,
  reportId,
  departmentId,
  year,
  reportType,
  lineItems,
  userId
}) => {
  await client.query('DELETE FROM org_dept_line_items WHERE report_id = $1', [reportId]);
  const list = Array.isArray(lineItems) ? lineItems : [];

  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] || {};
    const rowIndex = Number.isInteger(Number(item.row_index)) ? Number(item.row_index) : index;
    const tableKey = String(item.table_key || 'unknown');
    const valuesJson = item.values_json && typeof item.values_json === 'object' ? item.values_json : {};

    // eslint-disable-next-line no-await-in-loop
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
        reportId,
        departmentId,
        year,
        reportType,
        tableKey,
        rowIndex,
        item.class_code || null,
        item.type_code || null,
        item.item_code || null,
        item.item_name || null,
        JSON.stringify(valuesJson),
        userId || null
      ]
    );
  }
};

const resolveArchiveTarget = async ({ client, scope, unitId, departmentId }) => {
  const effectiveScope = normalizeArchiveScope(scope);

  if (effectiveScope === ARCHIVE_SCOPE.DEPARTMENT) {
    const resolvedDepartmentId = String(departmentId || '').trim();
    if (!resolvedDepartmentId) {
      throw new Error('department_id is required for department scope');
    }
    const departmentCheck = await client.query(
      `SELECT id
       FROM org_department
       WHERE id = $1`,
      [resolvedDepartmentId]
    );
    if (departmentCheck.rowCount === 0) {
      const error = new Error('department_id not found');
      error.code = 'DEPARTMENT_NOT_FOUND';
      throw error;
    }
    return {
      scope: ARCHIVE_SCOPE.DEPARTMENT,
      departmentId: resolvedDepartmentId,
      unitId: null
    };
  }

  const resolvedUnitId = String(unitId || '').trim();
  if (!resolvedUnitId) {
    throw new Error('unit_id is required for unit scope');
  }

  const unitResult = await client.query(
    `SELECT u.department_id
     FROM org_unit u
     WHERE u.id = $1`,
    [resolvedUnitId]
  );
  const mappedDepartmentId = unitResult.rows[0]?.department_id ? String(unitResult.rows[0].department_id) : null;
  if (!mappedDepartmentId) {
    const error = new Error('unit_id has no mapped department');
    error.code = 'UNIT_DEPARTMENT_NOT_FOUND';
    throw error;
  }

  const expectedDepartmentId = String(departmentId || '').trim();
  if (expectedDepartmentId && expectedDepartmentId !== mappedDepartmentId) {
    const error = new Error('unit_id does not belong to department_id');
    error.code = 'UNIT_DEPARTMENT_MISMATCH';
    throw error;
  }

  return {
    scope: ARCHIVE_SCOPE.UNIT,
    departmentId: mappedDepartmentId,
    unitId: resolvedUnitId
  };
};

const upsertArchiveFromPdf = async ({
  client,
  unitId = null,
  departmentId = null,
  scope = ARCHIVE_SCOPE.UNIT,
  year,
  fileName,
  fileHash,
  fileSize,
  sourceFilePath,
  uploadedBy,
  reportType
}) => {
  const target = await resolveArchiveTarget({
    client,
    scope,
    unitId,
    departmentId
  });
  const resolvedDepartmentId = target.departmentId;
  const resolvedUnitId = target.unitId;
  const effectiveScope = target.scope;

  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
    throw new Error('invalid year');
  }

  const effectiveReportType = normalizeReportType(reportType, fileName);

  await ensureArchiveUploadDir();
  const archiveFilePath = buildArchiveStoredPath(fileName);

  try {
    await fs.copyFile(sourceFilePath, archiveFilePath);
    const fileBuffer = await fs.readFile(archiveFilePath);
    const extractedText = await extractPdfText(fileBuffer);

    if (effectiveScope === ARCHIVE_SCOPE.DEPARTMENT) {
      const existingReportResult = await client.query(
        `SELECT id
         FROM org_dept_annual_report
         WHERE department_id = $1
           AND year = $2
           AND report_type = $3
           AND unit_id IS NULL`,
        [resolvedDepartmentId, parsedYear, effectiveReportType]
      );
      const existingReportIds = existingReportResult.rows.map((row) => row.id).filter(Boolean);
      if (existingReportIds.length > 0) {
        await client.query('DELETE FROM org_dept_text_content WHERE source_report_id = ANY($1::uuid[])', [existingReportIds]);
        await client.query('DELETE FROM org_dept_table_data WHERE report_id = ANY($1::uuid[])', [existingReportIds]);
        await client.query('DELETE FROM org_dept_line_items WHERE report_id = ANY($1::uuid[])', [existingReportIds]);
        await client.query('DELETE FROM org_dept_annual_report WHERE id = ANY($1::uuid[])', [existingReportIds]);
      }
    }

    const reportResult = effectiveScope === ARCHIVE_SCOPE.DEPARTMENT
      ? await client.query(
        `INSERT INTO org_dept_annual_report
           (department_id, unit_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          resolvedDepartmentId,
          parsedYear,
          effectiveReportType,
          fileName,
          archiveFilePath,
          fileHash,
          Number(fileSize || 0),
          uploadedBy || null
        ]
      )
      : await client.query(
        `INSERT INTO org_dept_annual_report
           (department_id, unit_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (department_id, unit_id, year, report_type)
         DO UPDATE SET
           file_name = EXCLUDED.file_name,
           file_path = EXCLUDED.file_path,
           file_hash = EXCLUDED.file_hash,
           file_size = EXCLUDED.file_size,
           uploaded_by = EXCLUDED.uploaded_by,
           updated_at = NOW()
         RETURNING *`,
        [
          resolvedDepartmentId,
          resolvedUnitId,
          parsedYear,
          effectiveReportType,
          fileName,
          archiveFilePath,
          fileHash,
          Number(fileSize || 0),
          uploadedBy || null
        ]
      );

    const report = reportResult.rows[0];
    let tables = [];
    let lineItems = [];

    await client.query(
      `DELETE FROM org_dept_text_content
       WHERE department_id = $1
         AND unit_id IS NOT DISTINCT FROM $2
         AND year = $3
         AND report_type = $4`,
      [resolvedDepartmentId, resolvedUnitId, parsedYear, effectiveReportType]
    );

    if (extractedText) {
      await upsertArchiveTextContent({
        client,
        departmentId: resolvedDepartmentId,
        unitId: resolvedUnitId,
        year: parsedYear,
        reportType: effectiveReportType,
        category: 'RAW',
        content: extractedText,
        reportId: report.id,
        userId: uploadedBy
      });

      const sections = extractSectionsFromText(extractedText);
      const baseCategories = {
        FUNCTION: sections.FUNCTION,
        STRUCTURE: sections.STRUCTURE,
        TERMINOLOGY: sections.TERMINOLOGY,
        EXPLANATION: sections.EXPLANATION,
        OTHER: sections.OTHER
      };

      for (const [category, content] of Object.entries(baseCategories)) {
        // eslint-disable-next-line no-await-in-loop
        await upsertArchiveTextContent({
          client,
          departmentId: resolvedDepartmentId,
          unitId: resolvedUnitId,
          year: parsedYear,
          reportType: effectiveReportType,
          category,
          content,
          reportId: report.id,
          userId: uploadedBy
        });
      }

      const explanationSubs = extractExplanationSubSections(sections.EXPLANATION);
      const otherSubs = extractOtherSubSections(sections.OTHER);
      for (const [category, content] of Object.entries({ ...explanationSubs, ...otherSubs })) {
        // eslint-disable-next-line no-await-in-loop
        await upsertArchiveTextContent({
          client,
          departmentId: resolvedDepartmentId,
          unitId: resolvedUnitId,
          year: parsedYear,
          reportType: effectiveReportType,
          category,
          content,
          reportId: report.id,
          userId: uploadedBy
        });
      }

      const parser = loadArchiveTableParser();
      const extractedTables = parser.extractTablesFromText(extractedText);
      tables = Array.isArray(extractedTables) ? extractedTables : [];
      const extractedLineItems = parser.extractLineItemsFromTables(tables);
      lineItems = Array.isArray(extractedLineItems) ? extractedLineItems : [];
    }

    await replaceArchiveTableData({
      client,
      reportId: report.id,
      departmentId: resolvedDepartmentId,
      year: parsedYear,
      reportType: effectiveReportType,
      tables,
      userId: uploadedBy
    });

    await replaceArchiveLineItems({
      client,
      reportId: report.id,
      departmentId: resolvedDepartmentId,
      year: parsedYear,
      reportType: effectiveReportType,
      lineItems,
      userId: uploadedBy
    });

    return {
      report_id: String(report.id),
      department_id: resolvedDepartmentId,
      unit_id: resolvedUnitId,
      scope: effectiveScope,
      report_type: effectiveReportType,
      extracted_text_length: extractedText.length,
      table_count: tables.length,
      line_item_count: lineItems.length,
      archive_file_path: archiveFilePath
    };
  } catch (error) {
    error.archiveFilePath = error.archiveFilePath || archiveFilePath;
    throw error;
  }
};

module.exports = {
  upsertArchiveFromPdf,
  __private: {
    ARCHIVE_SCOPE,
    normalizeReportType,
    normalizeArchiveScope,
    extractSectionsFromText,
    extractExplanationSubSections,
    extractOtherSubSections
  }
};
