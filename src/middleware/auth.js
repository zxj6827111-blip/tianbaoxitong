const { AppError } = require('../errors');
const { verifyToken } = require('../auth/jwt');
const { getUserWithRoles } = require('../services/userService');

const ADMIN_LIKE_ROLES = new Set(['admin', 'maintainer']);
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return next(new AppError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Missing authentication token'
    }));
  }

  try {
    const payload = verifyToken(token);
    const user = await getUserWithRoles(payload.userId);

    if (!user) {
      return next(new AppError({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Invalid authentication token'
      }));
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(new AppError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid authentication token'
    }));
  }
};

const hasAnyRole = (user, allowedRoles) => {
  const userRoles = user?.roles || [];
  return userRoles.some((role) => allowedRoles.includes(role));
};

const isAdminLike = (user) => hasAnyRole(user, Array.from(ADMIN_LIKE_ROLES));

const requireRole = (allowedRoles) => (req, res, next) => {
  const hasAccess = hasAnyRole(req.user, allowedRoles);

  if (!hasAccess) {
    return next(new AppError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions'
    }));
  }

  return next();
};

const normalizeManagedUnitIds = (user) => {
  const values = Array.isArray(user?.managed_unit_ids) ? user.managed_unit_ids : [];
  const result = [];
  const seen = new Set();

  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
};

const scopeAllowsUnit = (scopeFilter, unitId) => {
  if (!scopeFilter || !unitId) return false;
  const normalizedUnitId = String(unitId);
  if (scopeFilter.unit_id && String(scopeFilter.unit_id) === normalizedUnitId) {
    return true;
  }
  if (Array.isArray(scopeFilter.unit_ids)) {
    return scopeFilter.unit_ids.some((candidate) => String(candidate) === normalizedUnitId);
  }
  return false;
};

const buildScopeFilter = (user) => {
  if (isAdminLike(user)) {
    return null;
  }

  const unitId = user?.unit_id ? String(user.unit_id) : null;
  const departmentId = user?.department_id ? String(user.department_id) : null;
  const managedUnitIds = normalizeManagedUnitIds(user);

  if (unitId && !managedUnitIds.includes(unitId)) {
    managedUnitIds.unshift(unitId);
  }

  if (!unitId && !departmentId && managedUnitIds.length === 0) {
    return null;
  }

  return {
    unit_id: unitId,
    department_id: departmentId,
    unit_ids: managedUnitIds
  };
};

const canWriteWithScope = (user, scopeFilter) => {
  if (isAdminLike(user)) {
    return true;
  }

  const roles = user?.roles || [];
  if (roles.includes('viewer')) {
    return false;
  }

  // Reporter users can write only when they are bound to a concrete unit.
  if (roles.includes('reporter')) {
    return Boolean(
      scopeFilter?.unit_id
      || (Array.isArray(scopeFilter?.unit_ids) && scopeFilter.unit_ids.length > 0)
    );
  }

  return false;
};

const inferRequestedReportType = (req) => {
  if (/\/api\/final(\/|$)/i.test(String(req.originalUrl || ''))) {
    return 'FINAL';
  }
  const candidate = req.body?.report_type ?? req.query?.report_type;
  return String(candidate || '').trim().toUpperCase() === 'FINAL' ? 'FINAL' : 'BUDGET';
};

const canCreateRequestedReportType = (user, req) => {
  if (isAdminLike(user)) {
    return true;
  }

  const reportType = inferRequestedReportType(req);
  if (reportType === 'FINAL') {
    return user?.can_create_final !== false;
  }
  return user?.can_create_budget !== false;
};

const requireScope = (options = {}) => (req, res, next) => {
  const enforceWriteGuard = options.enforceWriteGuard !== false;
  const user = req.user;
  if (!user) {
    return next(new AppError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Missing authentication context'
    }));
  }

  const scopeFilter = buildScopeFilter(user);
  const scopeMeta = {
    isAdminLike: isAdminLike(user),
    canWrite: canWriteWithScope(user, scopeFilter),
    roles: Array.from(new Set(user.roles || [])),
    can_create_budget: user?.can_create_budget !== false,
    can_create_final: user?.can_create_final !== false,
    managed_unit_ids: normalizeManagedUnitIds(user)
  };

  req.scopeFilter = scopeFilter;
  req.scopeMeta = scopeMeta;

  if (!scopeMeta.isAdminLike && !scopeFilter) {
    return next(new AppError({
      statusCode: 403,
      code: 'SCOPE_NOT_ASSIGNED',
      message: 'Current account has no data scope assigned'
    }));
  }

  const requestMethod = String(req.method || 'GET').toUpperCase();
  if (enforceWriteGuard && !READ_ONLY_METHODS.has(requestMethod) && !scopeMeta.canWrite) {
    return next(new AppError({
      statusCode: 403,
      code: 'READ_ONLY_SCOPE',
      message: 'Current account has read-only scope'
    }));
  }

  if (enforceWriteGuard && !READ_ONLY_METHODS.has(requestMethod) && !canCreateRequestedReportType(user, req)) {
    return next(new AppError({
      statusCode: 403,
      code: 'REPORT_TYPE_FORBIDDEN',
      message: 'Current account has no permission to create this report type'
    }));
  }

  return next();
};

module.exports = {
  requireAuth,
  requireRole,
  requireScope,
  isAdminLike,
  scopeAllowsUnit
};
