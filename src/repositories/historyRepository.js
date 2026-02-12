const db = require('../db');

const fetchUnitMapByCodes = async (client, unitCodes) => {
  if (unitCodes.length === 0) {
    return new Map();
  }
  const result = await client.query(
    `SELECT id, code
     FROM org_unit
     WHERE code = ANY($1)`,
    [unitCodes]
  );
  return new Map(result.rows.map((row) => [row.code, row.id]));
};

const findLockedUnitYears = async (client, unitIds, years) => {
  if (unitIds.length === 0) {
    return [];
  }
  const result = await client.query(
    `
      WITH incoming AS (
        SELECT *
        FROM UNNEST($1::uuid[], $2::int[]) AS t(unit_id, year)
      )
      SELECT DISTINCT ha.unit_id, ha.year
      FROM history_actuals ha
      JOIN incoming i ON ha.unit_id = i.unit_id AND ha.year = i.year
      WHERE ha.is_locked = true
    `,
    [unitIds, years]
  );
  return result.rows;
};

const createHistoryBatch = async (client, payload) => {
  const result = await client.query(
    `
      INSERT INTO history_import_batch
        (source_file_name, source_file_hash, status, errors_json)
      VALUES ($1, $2, $3, $4)
      RETURNING id, status, errors_json
    `,
    [
      payload.source_file_name,
      payload.source_file_hash,
      payload.status,
      payload.errors_json
    ]
  );
  return result.rows[0];
};

const updateHistoryBatch = async (client, batchId, payload) => {
  const result = await client.query(
    `
      UPDATE history_import_batch
      SET status = $1,
          errors_json = $2,
          updated_at = now()
      WHERE id = $3
      RETURNING id, status, errors_json
    `,
    [payload.status, payload.errors_json, batchId]
  );
  return result.rows[0];
};

const insertHistoryActuals = async (client, rows) => {
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO history_actuals
          (unit_id, year, stage, key, value_numeric, source_batch_id, is_locked)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        row.unit_id,
        row.year,
        row.stage,
        row.key,
        row.value_numeric,
        row.source_batch_id,
        row.is_locked
      ]
    );
  }
};

const lockHistoryBatch = async (client, batchId, lockedBy) => {
  const batchResult = await client.query(
    `
      UPDATE history_import_batch
      SET locked_at = now(),
          locked_by = $1,
          updated_at = now()
      WHERE id = $2
        AND locked_at IS NULL
      RETURNING id, locked_at
    `,
    [lockedBy, batchId]
  );

  if (batchResult.rowCount === 0) {
    const existing = await client.query(
      `SELECT id, locked_at FROM history_import_batch WHERE id = $1`,
      [batchId]
    );
    if (existing.rowCount === 0) {
      return { status: 'not_found' };
    }
    return { status: 'already_locked', locked_at: existing.rows[0].locked_at };
  }

  await client.query(
    `
      UPDATE history_actuals
      SET is_locked = true,
          updated_at = now()
      WHERE source_batch_id = $1
    `,
    [batchId]
  );

  return { status: 'locked', locked_at: batchResult.rows[0].locked_at };
};

const lookupHistoryActuals = async ({ unitId, year, keys }) => {
  const result = await db.query(
    `
      SELECT key, value_numeric
      FROM history_actuals
      WHERE unit_id = $1
        AND year = $2
        AND stage = $3
        AND key = ANY($4)
    `,
    [unitId, year, 'FINAL', keys]
  );
  return result.rows;
};

const upsertHistoryActualFromSuggestion = async ({
  client,
  unitId,
  year,
  key,
  valueNumeric,
  suggestionId
}) => {
  await client.query(
    `
      INSERT INTO history_actuals
        (unit_id, year, stage, key, value_numeric, provenance_source, source_suggestion_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (unit_id, year, stage, key)
      DO UPDATE SET
        value_numeric = EXCLUDED.value_numeric,
        provenance_source = EXCLUDED.provenance_source,
        source_suggestion_id = EXCLUDED.source_suggestion_id,
        updated_at = now()
    `,
    [unitId, year, 'FINAL', key, valueNumeric, 'suggestion', suggestionId]
  );
};

const listUnitHistoryYears = async ({ unitId, stage = 'FINAL' }) => {
  const result = await db.query(
    `
      SELECT year,
             COUNT(*) AS field_count,
             BOOL_OR(is_locked) AS is_locked
      FROM history_actuals
      WHERE unit_id = $1
        AND stage = $2
      GROUP BY year
      ORDER BY year DESC
    `,
    [unitId, stage]
  );

  return result.rows.map((row) => ({
    year: Number(row.year),
    field_count: Number(row.field_count),
    is_locked: Boolean(row.is_locked)
  }));
};

const getUnitHistoryByYear = async ({ unitId, year, stage = 'FINAL' }) => {
  const result = await db.query(
    `
      SELECT key, value_numeric
      FROM history_actuals
      WHERE unit_id = $1
        AND year = $2
        AND stage = $3
    `,
    [unitId, year, stage]
  );
  return result.rows;
};

module.exports = {
  fetchUnitMapByCodes,
  findLockedUnitYears,
  createHistoryBatch,
  updateHistoryBatch,
  insertHistoryActuals,
  lockHistoryBatch,
  lookupHistoryActuals,
  upsertHistoryActualFromSuggestion,
  listUnitHistoryYears,
  getUnitHistoryByYear
};
