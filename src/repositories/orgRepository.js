const db = require('../db');

const getDepartmentTreeWithCounts = async () => {
  const result = await db.query(
    `SELECT d.id,
            d.code,
            d.name,
            d.parent_id,
            d.created_at,
            d.updated_at,
            COALESCE(COUNT(u.id), 0) AS unit_count
     FROM org_department d
     LEFT JOIN org_unit u ON u.department_id = d.id
     GROUP BY d.id
     ORDER BY d.name ASC`
  );

  return result.rows;
};

const listUnits = async ({
  page = 1,
  pageSize = 20,
  departmentId,
  q,
  sortBy = 'name',
  sortOrder = 'asc'
}) => {
  const sortMap = {
    name: 'u.name',
    code: 'u.code',
    created_at: 'u.created_at'
  };
  const orderBy = sortMap[sortBy] || sortMap.name;
  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';

  const params = [];
  const conditions = [];

  if (departmentId) {
    params.push(departmentId);
    conditions.push(`u.department_id = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR u.code ILIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(Number(pageSize), 1);
  const offset = (Math.max(Number(page), 1) - 1) * limit;

  params.push(limit);
  params.push(offset);

  const query = `
    SELECT u.id, u.code, u.name, u.department_id, u.created_at, u.updated_at
    FROM org_unit u
    ${whereClause}
    ORDER BY ${orderBy} ${direction}
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const result = await db.query(query, params);
  return result.rows;
};

module.exports = {
  getDepartmentTreeWithCounts,
  listUnits
};
