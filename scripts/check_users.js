const { Client } = require('pg');
require('dotenv').config();

const checkUsers = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
  });

  try {
    await client.connect();
    console.log('Connected to database.\n');

    // 查询所有用户
    const usersResult = await client.query(
      `SELECT id, email, display_name, unit_id, department_id 
       FROM users 
       ORDER BY id`
    );

    console.log('=== Users in database ===');
    console.log(`Total users: ${usersResult.rowCount}\n`);
    
    for (const user of usersResult.rows) {
      console.log(`ID: ${user.id}`);
      console.log(`Email: ${user.email}`);
      console.log(`Display Name: ${user.display_name}`);
      console.log(`Unit ID: ${user.unit_id || 'NULL'}`);
      console.log(`Department ID: ${user.department_id || 'NULL'}`);
      
      // 查询用户角色
      const rolesResult = await client.query(
        `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [user.id]
      );
      
      console.log(`Roles: ${rolesResult.rows.map(r => r.name).join(', ') || 'None'}`);
      console.log('---');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
};

checkUsers();
