const { AppError } = require('../errors');
const { verifyToken } = require('../auth/jwt');
const { getUserWithRoles } = require('../services/userService');

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

const requireRole = (allowedRoles) => (req, res, next) => {
  const userRoles = req.user?.roles || [];
  const hasAccess = userRoles.some((role) => allowedRoles.includes(role));

  if (!hasAccess) {
    return next(new AppError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions'
    }));
  }

  return next();
};

module.exports = {
  requireAuth,
  requireRole
};
