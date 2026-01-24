const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const seedUsers = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
  });

  try {
    await client.connect();
    console.log('Connected to database.');

    // 检查是否已有用户
    const checkUser = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(checkUser.rows[0].count) > 0) {
      console.log('Users already exist. Skipping seed.');
      return;
    }

    // 创建测试用户
    const passwordHash = await bcrypt.hash('admin123', 10);
    
    await client.query('BEGIN');

    // 插入admin用户
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, display_name, unit_id, department_id)
       VALUES ($1, $2, $3, NULL, NULL)
       RETURNING id`,
      ['admin', passwordHash, 'Admin User']
    );

    const userId = userResult.rows[0].id;

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
    }

    await client.query('COMMIT');
    console.log('Test user created successfully:');
    console.log('  Email: admin');
    console.log('  Password: admin123');
    console.log('  Role: admin');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding users:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
};

seedUsers();
