const express = require('express');
const { AppError } = require('../errors');
const { signToken } = require('../auth/jwt');
const { verifyPassword } = require('../auth/password');
const { getUserByEmail, getUserWithRoles } = require('../services/userService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return next(new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Email and password are required'
    }));
  }

  const user = await getUserByEmail(email);

  if (!user) {
    return next(new AppError({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password'
    }));
  }

  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    return next(new AppError({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password'
    }));
  }

  const token = signToken({ userId: user.id });
  
  // 获取用户角色
  const userWithRoles = await getUserWithRoles(user.id);
  
  return res.json({ 
    token,
    user: {
      id: userWithRoles.id,
      username: userWithRoles.email,
      email: userWithRoles.email,
      role: userWithRoles.roles[0] || 'reporter',
      unit_id: userWithRoles.unit_id,
      department_id: userWithRoles.department_id
    }
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await getUserWithRoles(req.user.id);
  return res.json({ user });
});

module.exports = router;
