const jwt = require('jsonwebtoken');

const MIN_JWT_SECRET_LENGTH = 32;

const isWeakSecret = (secret) => {
  const value = String(secret || '').trim();
  if (!value) return true;
  if (value === 'replace-with-strong-secret') return true;
  return value.length < MIN_JWT_SECRET_LENGTH;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV !== 'test' && isWeakSecret(secret)) {
    throw new Error(`JWT_SECRET is missing or too weak. Use at least ${MIN_JWT_SECRET_LENGTH} characters.`);
  }
  return secret;
};

const signToken = (payload) => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });
};

const verifyToken = (token) => jwt.verify(token, getJwtSecret());

module.exports = {
  signToken,
  verifyToken,
  getJwtSecret
};
