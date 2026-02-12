const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const resetAdminPassword = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();

        const email = 'admin@example.com';
        const newPassword = 'admin123';

        console.log(`Resetting password for ${email}...`);

        // Hash the password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the password
        const result = await client.query(
            'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email, display_name',
            [hashedPassword, email]
        );

        if (result.rowCount > 0) {
            console.log('✅ Password updated successfully.');
            console.log('User:', result.rows[0]);
        } else {
            console.error('❌ User not found!');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

resetAdminPassword();
