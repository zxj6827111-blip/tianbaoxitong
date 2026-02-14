#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const db = require('../src/db');

const TARGETS = [
  { table: 'org_dept_annual_report', pk: 'id', columns: ['file_name'] },
  { table: 'org_dept_text_content', pk: 'id', columns: ['content_text'] },
  { table: 'org_dept_table_data', pk: 'id', columns: ['table_title'] },
  { table: 'org_dept_line_items', pk: 'id', columns: ['item_name'] }
];

const suspiciousCharRegex = /[锛銆鈥鍏鍐鍙鎻璇缁棰诲瓨骞]/;
const suspiciousCharCountRegex = /[锛銆鈥鍏鍐鍙鎻璇缁棰诲瓨骞]/g;
const suspiciousTokenRegex = /(鍙|涓夊叕|鏀跺叆|鏀嚭|鍐崇畻|棰勭畻|涓婁紶|鍚嶈瘝|鏈烘瀯|鍥涚被|宸蹵|璇疯緭鍏)/;

const parseArgs = (argv) => {
  const options = {
    apply: false,
    dryRun: true,
    limit: null,
    tables: null,
    reportFile: path.join('artifacts', 'mojibake-clean-report.json')
  };

  argv.forEach((arg) => {
    if (arg === '--apply') {
      options.apply = true;
      options.dryRun = false;
      return;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      options.apply = false;
      return;
    }
    if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isInteger(n) && n > 0) options.limit = n;
      return;
    }
    if (arg.startsWith('--tables=')) {
      const names = arg.slice('--tables='.length).split(',').map((s) => s.trim()).filter(Boolean);
      options.tables = names.length > 0 ? new Set(names) : null;
      return;
    }
    if (arg.startsWith('--report=')) {
      const out = arg.slice('--report='.length).trim();
      if (out) options.reportFile = out;
    }
  });

  return options;
};

const quoteIdent = (value) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid identifier: ${value}`);
  }
  return `"${value}"`;
};

const previewText = (value, max = 120) => {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
};

const scoreSuspicious = (value) => {
  if (!value) return 0;
  let score = 0;
  if (suspiciousTokenRegex.test(value)) score += 3;
  const chars = value.match(suspiciousCharCountRegex);
  if (chars) score += chars.length;
  return score;
};

const maybeRepair = (value) => {
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;

  const looksSuspicious = suspiciousCharRegex.test(value) || suspiciousTokenRegex.test(value);
  if (!looksSuspicious) return null;

  let repaired = '';
  try {
    repaired = iconv.decode(iconv.encode(value, 'gbk'), 'utf8');
  } catch {
    return null;
  }

  if (!repaired || repaired === value) return null;
  if (repaired.includes('\uFFFD')) return null;

  const beforeScore = scoreSuspicious(value);
  const afterScore = scoreSuspicious(repaired);
  if (afterScore >= beforeScore) return null;

  return repaired;
};

const selectTargets = (options) => {
  if (!options.tables) return TARGETS;
  return TARGETS.filter((target) => options.tables.has(target.table));
};

const fetchRows = async (target, limit) => {
  const table = quoteIdent(target.table);
  const cols = [target.pk, ...target.columns].map(quoteIdent);
  const where = target.columns.map((col) => `${quoteIdent(col)} IS NOT NULL`).join(' OR ');
  const sql = `SELECT ${cols.join(', ')} FROM ${table} WHERE ${where}${limit ? ` LIMIT ${Number(limit)}` : ''}`;
  const result = await db.query(sql);
  return result.rows;
};

const buildUpdateStatement = (target, patch) => {
  const cols = Object.keys(patch).filter((col) => col !== '__pk');
  const sets = cols.map((col, idx) => `${quoteIdent(col)} = $${idx + 1}`);
  const values = cols.map((col) => patch[col]);
  values.push(patch.__pk);
  const sql = `UPDATE ${quoteIdent(target.table)} SET ${sets.join(', ')} WHERE ${quoteIdent(target.pk)} = $${values.length}`;
  return { sql, values };
};

const ensureReportDir = (reportFile) => {
  const dir = path.dirname(reportFile);
  fs.mkdirSync(dir, { recursive: true });
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const targets = selectTargets(options);

  if (targets.length === 0) {
    console.log('No target tables matched. Nothing to do.');
    return;
  }

  const changes = [];
  const summary = {};
  const client = await db.getClient();

  try {
    if (options.apply) {
      await client.query('BEGIN');
    }

    for (const target of targets) {
      const rows = await fetchRows(target, options.limit);
      let changedRows = 0;
      let changedCells = 0;

      for (const row of rows) {
        const patch = {};
        const before = {};
        const after = {};

        target.columns.forEach((col) => {
          const oldValue = row[col];
          const newValue = maybeRepair(oldValue);
          if (newValue !== null) {
            patch[col] = newValue;
            before[col] = oldValue;
            after[col] = newValue;
            changedCells += 1;
          }
        });

        if (Object.keys(patch).length === 0) continue;

        changedRows += 1;
        patch.__pk = row[target.pk];

        changes.push({
          table: target.table,
          pk: row[target.pk],
          before_preview: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, previewText(v)])),
          after_preview: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, previewText(v)]))
        });

        if (options.apply) {
          const { sql, values } = buildUpdateStatement(target, patch);
          await client.query(sql, values);
        }
      }

      summary[target.table] = {
        scanned_rows: rows.length,
        changed_rows: changedRows,
        changed_cells: changedCells
      };
    }

    if (options.apply) {
      await client.query('COMMIT');
    }
  } catch (error) {
    if (options.apply) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }

  ensureReportDir(options.reportFile);
  fs.writeFileSync(
    options.reportFile,
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        generated_at: new Date().toISOString(),
        summary,
        total_changed_rows: changes.length,
        samples: changes.slice(0, 200)
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Report: ${options.reportFile}`);
  Object.entries(summary).forEach(([table, item]) => {
    console.log(`${table}: scanned=${item.scanned_rows}, changed_rows=${item.changed_rows}, changed_cells=${item.changed_cells}`);
  });
  console.log(`Total changed rows: ${changes.length}`);
};

main().catch((error) => {
  console.error('[clean_mojibake_db] failed:', error.message);
  process.exitCode = 1;
});
