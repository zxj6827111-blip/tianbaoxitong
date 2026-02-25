const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { hashPassword } = require('../auth/password');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const AVAILABLE_ROLES = new Set(['admin', 'maintainer', 'reporter', 'viewer']);

const normalizeNullable = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized;
};

const normalizeBoolean = (value, fallback = true) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeIdArray = (value) => {
  if (value === undefined) return undefined;

  const source = Array.isArray(value) ? value.flat(Infinity) : [value];
  const result = [];
  const seen = new Set();

  source.forEach((item) => {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
};

const resolveRole = (value) => {
  const roleName = String(value || '').trim().toLowerCase();
  if (!AVAILABLE_ROLES.has(roleName)) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'role must be one of admin/maintainer/reporter/viewer'
    });
  }
  return roleName;
};

const ensureRoleId = async (client, roleName) => {
  const result = await client.query('SELECT id FROM roles WHERE name = $1', [roleName]);
  if (result.rowCount === 0) {
    throw new AppError({
      statusCode: 500,
      code: 'ROLE_NOT_FOUND',
      message: `Role not found: ${roleName}`
    });
  }
  return String(result.rows[0].id);
};

const ensureDepartmentExists = async (client, departmentId) => {
  const result = await client.query('SELECT id, name FROM org_department WHERE id = $1', [departmentId]);
  if (result.rowCount === 0) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'department_id is invalid'
    });
  }
  return {
    department_id: String(result.rows[0].id),
    department_name: result.rows[0].name || null
  };
};

const resolveScopeByRole = async ({ client, roleName, unitId, departmentId, managedUnitIds = [] }) => {
  if (roleName === 'admin' || roleName === 'maintainer') {
    return {
      unit_id: null,
      department_id: null,
      managed_unit_ids: []
    };
  }

  const requestedUnitIds = [];
  const seenUnitIds = new Set();
  [unitId, ...(Array.isArray(managedUnitIds) ? managedUnitIds : [])].forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seenUnitIds.has(normalized)) return;
    seenUnitIds.add(normalized);
    requestedUnitIds.push(normalized);
  });

  if (!departmentId && requestedUnitIds.length === 0) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reporter/viewer must bind unit_id or department_id'
    });
  }

  if (roleName === 'viewer' && requestedUnitIds.length === 0) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'viewer role must bind unit_id'
    });
  }

  let resolvedDepartmentId = null;
  let resolvedUnitIds = [];

  if (departmentId) {
    const department = await ensureDepartmentExists(client, departmentId);
    resolvedDepartmentId = department.department_id;
  }

  if (requestedUnitIds.length > 0) {
    const unitRows = await client.query(
      `SELECT id, department_id
       FROM org_unit
       WHERE id = ANY($1::uuid[])`,
      [requestedUnitIds]
    );
    const rowById = new Map(
      unitRows.rows.map((row) => [
        String(row.id),
        {
          id: String(row.id),
          department_id: row.department_id ? String(row.department_id) : null
        }
      ])
    );

    if (rowById.size !== requestedUnitIds.length) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'managed_unit_ids contains invalid unit_id'
      });
    }

    requestedUnitIds.forEach((requestedId) => {
      const matched = rowById.get(String(requestedId));
      if (!matched) return;
      if (!resolvedDepartmentId) {
        resolvedDepartmentId = matched.department_id;
      }
      if (!matched.department_id || matched.department_id !== resolvedDepartmentId) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'unit_id does not belong to department_id'
        });
      }
      resolvedUnitIds.push(matched.id);
    });
  } else if (resolvedDepartmentId) {
    const allUnitsResult = await client.query(
      `SELECT id
       FROM org_unit
       WHERE department_id = $1
       ORDER BY sort_order ASC NULLS LAST, name ASC, id ASC`,
      [resolvedDepartmentId]
    );
    resolvedUnitIds = allUnitsResult.rows.map((row) => String(row.id));
  }

  if (roleName === 'viewer' && resolvedUnitIds.length === 0) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'viewer role must bind unit_id'
    });
  }

  return {
    unit_id: resolvedUnitIds[0] || null,
    department_id: resolvedDepartmentId,
    managed_unit_ids: resolvedUnitIds
  };
};

const appendAuditLog = async ({ client, req, action, entityId, meta }) => {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta_json, ip, user_agent)
     VALUES ($1, $2, 'users', $3, $4, $5, $6)`,
    [
      req.user?.id || null,
      action,
      entityId || null,
      meta ? JSON.stringify(meta) : null,
      req.ip || null,
      req.headers['user-agent'] || null
    ]
  );
};

const listUsers = async () => {
  const result = await db.query(
    `SELECT u.id,
            u.email,
            u.display_name,
            u.unit_id,
            u.department_id,
            u.managed_unit_ids,
            u.can_create_budget,
            u.can_create_final,
            u.created_at,
            u.updated_at,
            dep.name AS department_name,
            unit.name AS unit_name,
            COALESCE(array_remove(array_agg(DISTINCT managed_unit.name), NULL), '{}') AS managed_unit_names,
            COALESCE(array_remove(array_agg(DISTINCT r.name), NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN org_department dep ON dep.id = u.department_id
     LEFT JOIN org_unit unit ON unit.id = u.unit_id
     LEFT JOIN org_unit managed_unit ON managed_unit.id = ANY(u.managed_unit_ids)
     GROUP BY u.id, dep.name, unit.name
     ORDER BY u.created_at DESC`
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    display_name: row.display_name || '',
    unit_id: row.unit_id ? String(row.unit_id) : null,
    department_id: row.department_id ? String(row.department_id) : null,
    managed_unit_ids: Array.isArray(row.managed_unit_ids) ? row.managed_unit_ids.map((value) => String(value)) : [],
    managed_unit_names: Array.isArray(row.managed_unit_names) ? row.managed_unit_names : [],
    can_create_budget: row.can_create_budget !== false,
    can_create_final: row.can_create_final !== false,
    unit_name: row.unit_name || null,
    department_name: row.department_name || null,
    roles: Array.isArray(row.roles) ? row.roles : [],
    role: Array.isArray(row.roles) && row.roles.length > 0 ? row.roles[0] : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
};

router.use(requireAuth, requireRole(['admin']));

router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers();
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

router.get('/roles', async (req, res, next) => {
  try {
    const result = await db.query('SELECT name FROM roles ORDER BY name ASC');
    return res.json({
      roles: result.rows.map((row) => row.name)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const client = await db.getClient();
  try {
    const username = String(req.body?.email ?? req.body?.username ?? '').trim();
    const password = String(req.body?.password || '');
    const displayNameRaw = normalizeNullable(req.body?.display_name) || username;
    const roleName = resolveRole(req.body?.role || 'reporter');
    const requestedUnitId = normalizeNullable(req.body?.unit_id);
    const requestedDepartmentId = normalizeNullable(req.body?.department_id);
    const requestedManagedUnitIds = normalizeIdArray(req.body?.managed_unit_ids) || [];
    const canCreateBudget = normalizeBoolean(req.body?.can_create_budget, true);
    const canCreateFinal = normalizeBoolean(req.body?.can_create_final, true);

    if (!username) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'username is required'
      });
    }
    if (!password || password.length < 6) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'password must be at least 6 characters'
      });
    }

    await client.query('BEGIN');
    const scope = await resolveScopeByRole({
      client,
      roleName,
      unitId: requestedUnitId,
      departmentId: requestedDepartmentId,
      managedUnitIds: requestedManagedUnitIds
    });

    const roleId = await ensureRoleId(client, roleName);
    const passwordHash = await hashPassword(password);
    const insertResult = await client.query(
      `INSERT INTO users (
         email,
         password_hash,
         display_name,
         unit_id,
         department_id,
         managed_unit_ids,
         can_create_budget,
         can_create_final
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        username,
        passwordHash,
        displayNameRaw,
        scope.unit_id,
        scope.department_id,
        scope.managed_unit_ids,
        canCreateBudget,
        canCreateFinal
      ]
    );
    const userId = String(insertResult.rows[0].id);

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)`,
      [userId, roleId]
    );

    await appendAuditLog({
      client,
      req,
      action: 'ADMIN_USER_CREATED',
      entityId: userId,
      meta: {
        email: username,
        role: roleName,
        unit_id: scope.unit_id,
        department_id: scope.department_id,
        managed_unit_ids: scope.managed_unit_ids,
        can_create_budget: canCreateBudget,
        can_create_final: canCreateFinal
      }
    });

    await client.query('COMMIT');
    const users = await listUsers();
    const user = users.find((item) => item.id === userId) || null;
    return res.status(201).json({ user });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors.
    }

    if (error?.code === '23505') {
      return next(new AppError({
        statusCode: 409,
        code: 'DUPLICATE_EMAIL',
        message: 'username already exists'
      }));
    }

    return next(error);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res, next) => {
  const client = await db.getClient();
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid user id'
      });
    }

    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT id,
              email,
              display_name,
              unit_id,
              department_id,
              managed_unit_ids,
              can_create_budget,
              can_create_final
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    if (existingResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    const existingUser = existingResult.rows[0];
    const existingRoleResult = await client.query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.name ASC
       LIMIT 1`,
      [userId]
    );
    const currentRole = existingRoleResult.rows[0]?.name || 'reporter';

    const nextEmail = (req.body?.email !== undefined || req.body?.username !== undefined)
      ? String(req.body?.email ?? req.body?.username ?? '').trim()
      : existingUser.email;
    if (!nextEmail) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'username is required'
      });
    }

    const nextDisplayName = req.body?.display_name !== undefined
      ? (normalizeNullable(req.body?.display_name) || nextEmail)
      : existingUser.display_name;
    const nextRole = req.body?.role !== undefined ? resolveRole(req.body?.role) : currentRole;
    const requestedUnitId = req.body?.unit_id !== undefined
      ? normalizeNullable(req.body?.unit_id)
      : (existingUser.unit_id ? String(existingUser.unit_id) : null);
    const requestedDepartmentId = req.body?.department_id !== undefined
      ? normalizeNullable(req.body?.department_id)
      : (existingUser.department_id ? String(existingUser.department_id) : null);
    const requestedManagedUnitIds = req.body?.managed_unit_ids !== undefined
      ? (normalizeIdArray(req.body?.managed_unit_ids) || [])
      : (Array.isArray(existingUser.managed_unit_ids) ? existingUser.managed_unit_ids.map((value) => String(value)) : []);
    const scope = await resolveScopeByRole({
      client,
      roleName: nextRole,
      unitId: requestedUnitId,
      departmentId: requestedDepartmentId,
      managedUnitIds: requestedManagedUnitIds
    });
    const nextCanCreateBudget = req.body?.can_create_budget !== undefined
      ? normalizeBoolean(req.body?.can_create_budget, true)
      : existingUser.can_create_budget !== false;
    const nextCanCreateFinal = req.body?.can_create_final !== undefined
      ? normalizeBoolean(req.body?.can_create_final, true)
      : existingUser.can_create_final !== false;

    const password = req.body?.password !== undefined ? String(req.body.password || '') : null;
    const passwordHash = password
      ? await hashPassword(password)
      : null;

    await client.query(
      `UPDATE users
       SET email = $1,
           display_name = $2,
           unit_id = $3,
           department_id = $4,
           managed_unit_ids = $5,
           can_create_budget = $6,
           can_create_final = $7,
           password_hash = COALESCE($8, password_hash),
           updated_at = NOW()
       WHERE id = $9`,
      [
        nextEmail,
        nextDisplayName,
        scope.unit_id,
        scope.department_id,
        scope.managed_unit_ids,
        nextCanCreateBudget,
        nextCanCreateFinal,
        passwordHash,
        userId
      ]
    );

    const nextRoleId = await ensureRoleId(client, nextRole);
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)`,
      [userId, nextRoleId]
    );

    await appendAuditLog({
      client,
      req,
      action: 'ADMIN_USER_UPDATED',
      entityId: userId,
      meta: {
        email: nextEmail,
        role: nextRole,
        unit_id: scope.unit_id,
        department_id: scope.department_id,
        managed_unit_ids: scope.managed_unit_ids,
        can_create_budget: nextCanCreateBudget,
        can_create_final: nextCanCreateFinal,
        password_changed: Boolean(password)
      }
    });

    await client.query('COMMIT');
    const users = await listUsers();
    const user = users.find((item) => item.id === userId) || null;
    return res.json({ user });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors.
    }

    if (error?.code === '23505') {
      return next(new AppError({
        statusCode: 409,
        code: 'DUPLICATE_EMAIL',
        message: 'username already exists'
      }));
    }
    return next(error);
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res, next) => {
  const client = await db.getClient();
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid user id'
      });
    }
    if (String(req.user?.id || '') === userId) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Cannot delete yourself'
      });
    }

    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT id, email
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    if (existingResult.rowCount === 0) {
      throw new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    const targetRoleResult = await client.query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId]
    );
    const targetRoles = new Set(targetRoleResult.rows.map((row) => row.name));
    if (targetRoles.has('admin')) {
      const adminRows = await client.query(
        `SELECT ur.user_id
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE r.name = 'admin'
         FOR UPDATE`
      );
      const adminIds = new Set(adminRows.rows.map((row) => String(row.user_id)));
      if (adminIds.size <= 1 && adminIds.has(userId)) {
        throw new AppError({
          statusCode: 400,
          code: 'LAST_ADMIN_FORBIDDEN',
          message: 'Cannot delete the last admin user'
        });
      }
    }

    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await appendAuditLog({
      client,
      req,
      action: 'ADMIN_USER_DELETED',
      entityId: userId,
      meta: {
        email: existingResult.rows[0].email,
        roles: Array.from(targetRoles)
      }
    });
    await client.query('COMMIT');
    return res.json({ success: true });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors.
    }
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
