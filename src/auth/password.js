const bcrypt = require('bcryptjs');

const hashPassword = async (plainText) => bcrypt.hash(plainText, 10);

const verifyPassword = async (plainText, hash) => bcrypt.compare(plainText, hash);

module.exports = {
  hashPassword,
  verifyPassword
};
