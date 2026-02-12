const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const fixAdminCredentials = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();
        console.log('Connected to database.\n');

        // 1. 查看当前用户状态
        const users = await client.query('SELECT id, email, display_name FROM users ORDER BY id');
        console.log('=== 当前用户列表 ===');
        for (const u of users.rows) {
            console.log(`  ID: ${u.id}, Email: ${u.email}, Name: ${u.display_name}`);
        }
        console.log('');

        // 2. 将所有 admin 相关用户的 email 改回 'admin'，密码改回 'admin123'
        const newPassword = 'admin123';
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 查找 admin 用户（email 可能是 'admin' 或 'admin@example.com'）
        const result = await client.query(
            `UPDATE users 
             SET email = 'admin', password_hash = $1, display_name = 'Admin User'
             WHERE email IN ('admin', 'admin@example.com')
             RETURNING id, email, display_name`,
            [hashedPassword]
        );

        if (result.rowCount > 0) {
            console.log('✅ 修复成功!');
            for (const row of result.rows) {
                console.log(`  用户 ID: ${row.id}`);
                console.log(`  Email: ${row.email}`);
                console.log(`  显示名: ${row.display_name}`);
            }
            console.log(`\n  登录凭据: admin / ${newPassword}`);
        } else {
            console.log('❌ 未找到 admin 用户!');
        }

        // 3. 验证结果
        console.log('\n=== 验证修复后用户 ===');
        const verify = await client.query('SELECT id, email, display_name FROM users WHERE email = $1', ['admin']);
        if (verify.rowCount > 0) {
            const u = verify.rows[0];
            console.log(`  ID: ${u.id}, Email: ${u.email}, Name: ${u.display_name}`);

            // 验证密码
            const storedHash = (await client.query('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0].password_hash;
            const isMatch = await bcrypt.compare(newPassword, storedHash);
            console.log(`  密码验证: ${isMatch ? '✅ 正确' : '❌ 不匹配'}`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

fixAdminCredentials();
