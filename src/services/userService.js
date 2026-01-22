const db = require('../db');

const getUserByEmail = async (email) => {
  const result = await db.query(
    'SELECT id, email, password_hash, display_name FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
};

const getUserWithRoles = async (userId) => {
  const userResult = await db.query(
    'SELECT id, email, display_name FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rowCount === 0) {
    return null;
  }

  const rolesResult = await db.query(
    `SELECT r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );

  return {
    ...userResult.rows[0],
    roles: rolesResult.rows.map((row) => row.name)
  };
};

module.exports = {
  getUserByEmail,
  getUserWithRoles
};
