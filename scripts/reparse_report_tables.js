require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Client } = require('pg');

const readArg = (name) => {
  const index = process.argv.findIndex((arg) => arg === name);
  if (index < 0) return null;
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) return null;
  return next;
};

const hasFlag = (name) => process.argv.includes(name);

const loadExtractors = () => {
  const routeFile = path.resolve(__dirname, '../src/routes/adminArchives.js');
  const source = fs.readFileSync(routeFile, 'utf8');
  const injected = `${source}
module.exports.__extractTablesFromText = extractTablesFromText;
module.exports.__extractLineItemsFromTables = extractLineItemsFromTables;
`;

  const mod = new Module(routeFile, module);
  mod.filename = routeFile;
  mod.paths = Module._nodeModulePaths(path.dirname(routeFile));
  mod._compile(injected, routeFile);
  return {
    extractTablesFromText: mod.exports.__extractTablesFromText,
    extractLineItemsFromTables: mod.exports.__extractLineItemsFromTables
  };
};

const summarizeTables = (tables) => {
  (Array.isArray(tables) ? tables : []).forEach((table) => {
    const pages = Array.isArray(table.page_numbers) ? table.page_numbers.join(',') : '';
    console.log(
      `${table.table_key}\trows=${table.row_count}\tcols=${table.col_count}\tpages=${pages}`
    );
  });
};

const insertTables = async ({ client, report, tables }) => {
  await client.query('DELETE FROM org_dept_table_data WHERE report_id = $1', [report.id]);
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
        report.department_id,
        report.year,
        report.report_type,
        table.table_key,
        table.table_title,
        table.page_numbers,
        table.row_count,
        table.col_count,
        JSON.stringify(table.rows),
        report.uploaded_by
      ]
    );
  }
};

const insertLineItems = async ({ client, report, lineItems }) => {
  await client.query('DELETE FROM org_dept_line_items WHERE report_id = $1', [report.id]);
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
        report.department_id,
        report.year,
        report.report_type,
        item.table_key,
        item.row_index,
        item.class_code,
        item.type_code,
        item.item_code,
        item.item_name,
        JSON.stringify(item.values_json),
        report.uploaded_by
      ]
    );
  }
};

const main = async () => {
  const reportId = readArg('--report-id');
  const apply = hasFlag('--apply');

  if (!reportId) {
    console.error('Usage: node scripts/reparse_report_tables.js --report-id <uuid> [--apply]');
    process.exit(1);
  }

  const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const { extractTablesFromText, extractLineItemsFromTables } = loadExtractors();
  if (typeof extractTablesFromText !== 'function') {
    throw new Error('Failed to load extractTablesFromText');
  }
  if (typeof extractLineItemsFromTables !== 'function') {
    throw new Error('Failed to load extractLineItemsFromTables');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const reportRes = await client.query(
      `SELECT id, department_id, year, report_type, uploaded_by
       FROM org_dept_annual_report
       WHERE id = $1`,
      [reportId]
    );
    if (reportRes.rowCount === 0) {
      throw new Error(`Report not found: ${reportId}`);
    }
    const report = reportRes.rows[0];

    const rawRes = await client.query(
      `SELECT content_text
       FROM org_dept_text_content
       WHERE source_report_id = $1
         AND category = 'RAW'
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [reportId]
    );
    if (rawRes.rowCount === 0 || !String(rawRes.rows[0].content_text || '').trim()) {
      throw new Error(`RAW text not found for report: ${reportId}`);
    }

    const text = rawRes.rows[0].content_text;
    const tables = extractTablesFromText(text) || [];
    const lineItems = extractLineItemsFromTables(tables) || [];

    console.log(`report_id=${reportId}`);
    console.log(`tables=${tables.length}, line_items=${lineItems.length}`);
    summarizeTables(tables);

    if (!apply) {
      console.log('Dry-run only. Add --apply to write parsed tables and line items.');
      return;
    }

    await client.query('BEGIN');
    await insertTables({ client, report, tables });
    await insertLineItems({ client, report, lineItems });
    await client.query('COMMIT');
    console.log('Reparse applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

