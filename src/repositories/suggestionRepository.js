const db = require('../db');

const createSuggestion = async ({
  draftId,
  unitId,
  departmentId,
  year,
  key,
  oldValueWanyuan,
  suggestValueWanyuan,
  reason,
  attachments,
  createdBy
}) => {
  const result = await db.query(
    `INSERT INTO correction_suggestion
      (draft_id, unit_id, department_id, year, key, old_value_wanyuan, suggest_value_wanyuan, reason, attachments_json, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)
     RETURNING id, draft_id, unit_id, department_id, year, key, old_value_wanyuan, suggest_value_wanyuan,
               reason, attachments_json, status, created_by, created_at, updated_at`,
    [
      draftId,
      unitId,
      departmentId,
      year,
      key,
      oldValueWanyuan,
      suggestValueWanyuan,
      reason,
      attachments ? JSON.stringify(attachments) : null,
      createdBy
    ]
  );
  return result.rows[0];
};

const listDraftSuggestions = async (draftId) => {
  const result = await db.query(
    `SELECT id, draft_id, unit_id, department_id, year, key, old_value_wanyuan, suggest_value_wanyuan,
            reason, attachments_json, status, created_by, reviewed_by, reviewed_at, created_at, updated_at
     FROM correction_suggestion
     WHERE draft_id = $1
     ORDER BY created_at DESC`,
    [draftId]
  );
  return result.rows;
};

const listAdminSuggestions = async ({ status, year, departmentId, page, pageSize }) => {
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`cs.status = $${params.length}`);
  }
  if (year) {
    params.push(year);
    conditions.push(`cs.year = $${params.length}`);
  }
  if (departmentId) {
    params.push(departmentId);
    conditions.push(`cs.department_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(Number(pageSize), 1);
  const offset = (Math.max(Number(page), 1) - 1) * limit;

  const countResult = await db.query(
    `SELECT COUNT(*) AS total
     FROM correction_suggestion cs
     ${whereClause}`,
    params
  );

  params.push(limit);
  params.push(offset);

  const dataResult = await db.query(
    `SELECT cs.id, cs.draft_id, cs.unit_id, cs.department_id, cs.year, cs.key,
            cs.old_value_wanyuan, cs.suggest_value_wanyuan, cs.reason, cs.attachments_json,
            cs.status, cs.created_by, cs.reviewed_by, cs.reviewed_at, cs.created_at, cs.updated_at,
            u.name AS unit_name, d.name AS department_name
     FROM correction_suggestion cs
     LEFT JOIN org_unit u ON u.id = cs.unit_id
     LEFT JOIN org_department d ON d.id = cs.department_id
     ${whereClause}
     ORDER BY cs.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    total: Number(countResult.rows[0]?.total || 0),
    items: dataResult.rows
  };
};

const getSuggestionById = async (suggestionId, client = db) => {
  const result = await client.query(
    `SELECT id, draft_id, unit_id, department_id, year, key, old_value_wanyuan, suggest_value_wanyuan,
            reason, attachments_json, status, created_by, reviewed_by, reviewed_at, created_at, updated_at
     FROM correction_suggestion
     WHERE id = $1`,
    [suggestionId]
  );
  return result.rows[0];
};

const updateSuggestionStatus = async (suggestionId, status, reviewerId, client = db) => {
  const result = await client.query(
    `UPDATE correction_suggestion
     SET status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $3
     RETURNING id, status, reviewed_by, reviewed_at, updated_at`,
    [status, reviewerId, suggestionId]
  );
  return result.rows[0];
};

const fetchLatestSuggestions = async ({ unitId, year, keys }) => {
  if (!keys || keys.length === 0) {
    return [];
  }
  const result = await db.query(
    `SELECT DISTINCT ON (key)
            key, suggest_value_wanyuan, status, created_at
     FROM correction_suggestion
     WHERE unit_id = $1
       AND year = $2
       AND key = ANY($3)
       AND status IN ('PENDING', 'APPROVED')
     ORDER BY key, created_at DESC`,
    [unitId, year, keys]
  );
  return result.rows;
};

module.exports = {
  createSuggestion,
  listDraftSuggestions,
  listAdminSuggestions,
  getSuggestionById,
  updateSuggestionStatus,
  fetchLatestSuggestions
};
