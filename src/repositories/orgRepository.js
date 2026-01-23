const db = require('../db');

const getDepartmentTreeWithCounts = async ({ year } = {}) => {
  const params = [year ?? null];
  const result = await db.query(
    `
      WITH unit_status AS (
        SELECT u.id,
               u.department_id,
               CASE WHEN ha.unit_id IS NULL THEN 1 ELSE 0 END AS missing_archive,
               COALESCE(pending.pending_count, 0) AS pending_count,
               CASE WHEN baseinfo.unit_id IS NULL THEN 1 ELSE 0 END AS missing_baseinfo
        FROM org_unit u
        LEFT JOIN (
          SELECT unit_id,
                 COUNT(*) AS archive_count,
                 BOOL_OR(is_locked) AS has_locked
          FROM history_actuals
          WHERE ($1::int IS NULL OR year = $1)
          GROUP BY unit_id
        ) ha ON ha.unit_id = u.id
        LEFT JOIN (
          SELECT unit_id,
                 COUNT(*) AS pending_count
          FROM correction_suggestion
          WHERE status = 'PENDING'
            AND ($1::int IS NULL OR year = $1)
          GROUP BY unit_id
        ) pending ON pending.unit_id = u.id
        LEFT JOIN (
          SELECT scope_id AS unit_id
          FROM base_info_version
          WHERE scope_type = 'unit'
            AND is_active = true
            AND ($1::int IS NULL OR year = $1)
          GROUP BY scope_id
        ) baseinfo ON baseinfo.unit_id = u.id
      )
      SELECT d.id,
             d.code,
             d.name,
             d.parent_id,
             d.created_at,
             d.updated_at,
             COALESCE(COUNT(u.id), 0) AS total_units,
             COALESCE(SUM(unit_status.missing_archive), 0) AS missing_archive,
             COALESCE(SUM(CASE WHEN unit_status.pending_count > 0 THEN 1 ELSE 0 END), 0) AS pending_suggestions,
             COALESCE(SUM(unit_status.missing_baseinfo), 0) AS missing_baseinfo,
             COALESCE(SUM(
               CASE
                 WHEN unit_status.missing_archive = 1
                      OR unit_status.pending_count > 0
                      OR unit_status.missing_baseinfo = 1 THEN 1
                 ELSE 0
               END
             ), 0) AS todo_units
      FROM org_department d
      LEFT JOIN org_unit u ON u.department_id = d.id
      LEFT JOIN unit_status ON unit_status.id = u.id
      GROUP BY d.id
      ORDER BY d.name ASC
    `,
    params
  );

  return result.rows.map(row => ({
    ...row,
    total_units: Number(row.total_units),
    missing_archive: Number(row.missing_archive),
    pending_suggestions: Number(row.pending_suggestions),
    missing_baseinfo: Number(row.missing_baseinfo),
    todo_units: Number(row.todo_units)
  }));
};

const listUnits = async ({
  year,
  page = 1,
  pageSize = 20,
  departmentId,
  q,
  filter
}) => {
  const params = [year ?? null];
  const conditions = [];

  if (departmentId) {
    params.push(departmentId);
    conditions.push(`u.department_id = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR u.code ILIKE $${params.length})`);
  }

  if (filter === 'missingArchive') {
    conditions.push('archive.archive_count IS NULL');
  }

  if (filter === 'pendingSug') {
    conditions.push('COALESCE(pending.pending_count, 0) > 0');
  }

  if (filter === 'missingBase') {
    conditions.push('baseinfo.unit_id IS NULL');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(Number(pageSize), 1);
  const offset = (Math.max(Number(page), 1) - 1) * limit;
  params.push(limit);
  params.push(offset);

  const countQuery = `
    WITH archive AS (
      SELECT unit_id,
             COUNT(*) AS archive_count,
             BOOL_OR(is_locked) AS has_locked
      FROM history_actuals
      WHERE ($1::int IS NULL OR year = $1)
      GROUP BY unit_id
    ),
    pending AS (
      SELECT unit_id,
             COUNT(*) AS pending_count
      FROM correction_suggestion
      WHERE status = 'PENDING'
        AND ($1::int IS NULL OR year = $1)
      GROUP BY unit_id
    ),
    baseinfo AS (
      SELECT scope_id AS unit_id
      FROM base_info_version
      WHERE scope_type = 'unit'
        AND is_active = true
        AND ($1::int IS NULL OR year = $1)
      GROUP BY scope_id
    )
    SELECT COUNT(*) AS total
    FROM org_unit u
    LEFT JOIN archive ON archive.unit_id = u.id
    LEFT JOIN pending ON pending.unit_id = u.id
    LEFT JOIN baseinfo ON baseinfo.unit_id = u.id
    ${whereClause}
  `;

  const dataQuery = `
    WITH archive AS (
      SELECT unit_id,
             COUNT(*) AS archive_count,
             BOOL_OR(is_locked) AS has_locked
      FROM history_actuals
      WHERE ($1::int IS NULL OR year = $1)
      GROUP BY unit_id
    ),
    pending AS (
      SELECT unit_id,
             COUNT(*) AS pending_count
      FROM correction_suggestion
      WHERE status = 'PENDING'
        AND ($1::int IS NULL OR year = $1)
      GROUP BY unit_id
    ),
    baseinfo AS (
      SELECT scope_id AS unit_id,
             MAX(updated_at) AS updated_at
      FROM base_info_version
      WHERE scope_type = 'unit'
        AND is_active = true
        AND ($1::int IS NULL OR year = $1)
      GROUP BY scope_id
    ),
    draft AS (
      SELECT DISTINCT ON (unit_id)
             unit_id,
             status,
             updated_at
      FROM report_draft
      WHERE ($1::int IS NULL OR year = $1)
      ORDER BY unit_id, updated_at DESC
    )
    SELECT u.id,
           u.code,
           u.name,
           u.department_id,
           u.updated_at,
           CASE
             WHEN archive.archive_count IS NULL THEN 'missing'
             WHEN archive.has_locked THEN 'locked'
             ELSE 'stored'
           END AS archive_status,
           COALESCE(pending.pending_count, 0) AS pending_count,
           CASE WHEN baseinfo.unit_id IS NULL THEN false ELSE true END AS baseinfo_ok,
           draft.status AS draft_status
    FROM org_unit u
    LEFT JOIN archive ON archive.unit_id = u.id
    LEFT JOIN pending ON pending.unit_id = u.id
    LEFT JOIN baseinfo ON baseinfo.unit_id = u.id
    LEFT JOIN draft ON draft.unit_id = u.id
    ${whereClause}
    ORDER BY u.name ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const [countResult, dataResult] = await Promise.all([
    db.query(countQuery, params.slice(0, params.length - 2)),
    db.query(dataQuery, params)
  ]);

  return {
    total: Number(countResult.rows[0]?.total || 0),
    items: dataResult.rows.map(row => ({
      ...row,
      pending_count: Number(row.pending_count)
    }))
  };
};

const getUnitDetail = async ({ unitId, year }) => {
  const params = [year ?? null, unitId];
  const result = await db.query(
    `
      WITH archive AS (
        SELECT unit_id,
               COUNT(*) AS archive_count,
               BOOL_OR(is_locked) AS has_locked
        FROM history_actuals
        WHERE ($1::int IS NULL OR year = $1)
        GROUP BY unit_id
      ),
      pending AS (
        SELECT unit_id,
               COUNT(*) AS pending_count
        FROM correction_suggestion
        WHERE status = 'PENDING'
          AND ($1::int IS NULL OR year = $1)
        GROUP BY unit_id
      ),
      baseinfo AS (
        SELECT scope_id AS unit_id,
               MAX(updated_at) AS updated_at
        FROM base_info_version
        WHERE scope_type = 'unit'
          AND is_active = true
          AND ($1::int IS NULL OR year = $1)
        GROUP BY scope_id
      ),
      draft AS (
        SELECT DISTINCT ON (unit_id)
               unit_id,
               status,
               updated_at
        FROM report_draft
        WHERE ($1::int IS NULL OR year = $1)
        ORDER BY unit_id, updated_at DESC
      )
      SELECT u.id,
             u.code,
             u.name,
             u.department_id,
             u.updated_at,
             CASE
               WHEN archive.archive_count IS NULL THEN 'missing'
               WHEN archive.has_locked THEN 'locked'
               ELSE 'stored'
             END AS archive_status,
             COALESCE(pending.pending_count, 0) AS pending_count,
             CASE WHEN baseinfo.unit_id IS NULL THEN false ELSE true END AS baseinfo_ok,
             draft.status AS draft_status
      FROM org_unit u
      LEFT JOIN archive ON archive.unit_id = u.id
      LEFT JOIN pending ON pending.unit_id = u.id
      LEFT JOIN baseinfo ON baseinfo.unit_id = u.id
      LEFT JOIN draft ON draft.unit_id = u.id
      WHERE u.id = $2
    `,
    params
  );

  const unit = result.rows[0] || null;
  if (!unit) {
    return null;
  }

  const auditLogs = await db.query(
    `
      SELECT action, created_at
      FROM audit_log
      WHERE entity_type = 'unit'
        AND entity_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `,
    [unitId]
  );

  return {
    ...unit,
    pending_count: Number(unit.pending_count),
    audit_logs: auditLogs.rows
  };
};

const getUnitBadges = async ({ unitId, year }) => {
  const params = [year ?? null, unitId];
  const result = await db.query(
    `
      SELECT u.id AS unit_id,
             CASE
               WHEN archive.archive_count IS NULL THEN 'missing'
               WHEN archive.has_locked THEN 'locked'
               ELSE 'stored'
             END AS archive_status,
             COALESCE(pending.pending_count, 0) AS pending_count,
             CASE WHEN baseinfo.unit_id IS NULL THEN false ELSE true END AS baseinfo_ok
      FROM org_unit u
      LEFT JOIN (
        SELECT unit_id,
               COUNT(*) AS archive_count,
               BOOL_OR(is_locked) AS has_locked
        FROM history_actuals
        WHERE ($1::int IS NULL OR year = $1)
        GROUP BY unit_id
      ) archive ON archive.unit_id = u.id
      LEFT JOIN (
        SELECT unit_id,
               COUNT(*) AS pending_count
        FROM correction_suggestion
        WHERE status = 'PENDING'
          AND ($1::int IS NULL OR year = $1)
        GROUP BY unit_id
      ) pending ON pending.unit_id = u.id
      LEFT JOIN (
        SELECT scope_id AS unit_id
        FROM base_info_version
        WHERE scope_type = 'unit'
          AND is_active = true
          AND ($1::int IS NULL OR year = $1)
        GROUP BY scope_id
      ) baseinfo ON baseinfo.unit_id = u.id
      WHERE u.id = $2
    `,
    params
  );

  const badge = result.rows[0] || null;
  if (!badge) {
    return null;
  }
  return {
    ...badge,
    pending_count: Number(badge.pending_count)
  };
};

module.exports = {
  getDepartmentTreeWithCounts,
  listUnits,
  getUnitDetail,
  getUnitBadges
};
