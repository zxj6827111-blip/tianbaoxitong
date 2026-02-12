const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const resetPassword = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        const email = 'test@example.com';
        const newPassword = 'password123';

        await client.connect();
        console.log('Connected to database.\n');

        // Hash the password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the password
        const result = await client.query(
            'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email',
            [hashedPassword, email]
        );

        if (result.rowCount > 0) {
            console.log(`Password for user ${email} checked and updated to '${newPassword}' successfully.`);
            console.log('User ID:', result.rows[0].id);
        } else {
            console.log(`User ${email} not found.`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

resetPassword();
