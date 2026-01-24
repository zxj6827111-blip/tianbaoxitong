const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const createAdminUser = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
  });

  try {
    await client.connect();
    console.log('Connected to database.\n');

    // 检查admin用户是否已存在
    const checkUser = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      ['admin']
    );

    if (checkUser.rowCount > 0) {
      console.log('Admin user already exists.');
      return;
    }

    // 创建密码哈希
    const passwordHash = await bcrypt.hash('admin123', 10);
    
    await client.query('BEGIN');

    // 插入admin用户
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
       VALUES ($1, $2, $3, NULL, NULL)
       RETURNING id`,
      ['admin', passwordHash, 'Administrator']
    );

    const userId = userResult.rows[0].id;
    console.log(`Created user with ID: ${userId}`);

    // 获取admin角色ID
    const roleResult = await client.query(
      `SELECT id FROM roles WHERE name = 'admin'`
    );

    if (roleResult.rowCount > 0) {
      const roleId = roleResult.rows[0].id;
      
      // 分配admin角色
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)`,
        [userId, roleId]
      );
      
      console.log('Assigned admin role to user.');
    } else {
      console.log('Warning: admin role not found in database.');
    }

    await client.query('COMMIT');
    
    console.log('\n✅ Admin user created successfully!');
    console.log('-----------------------------------');
    console.log('Email: admin');
    console.log('Password: admin123');
    console.log('-----------------------------------');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating admin user:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
};

createAdminUser();
