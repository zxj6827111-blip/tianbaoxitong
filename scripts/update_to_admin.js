const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const updateToAdmin = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        const oldEmail = 'test@example.com';
        const newUsername = 'admin';
        const newPassword = 'admin123';

        await client.connect();
        console.log('Connected to database.\n');

        // Hash the password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user
        // We update email to 'admin' (assuming logic allows it) and password
        const result = await client.query(
            'UPDATE users SET email = $1, username = $1, password_hash = $2 WHERE email = $3 OR email = $1 RETURNING id, email',
            [newUsername, hashedPassword, oldEmail]
        );

        if (result.rowCount > 0) {
            console.log(`User updated successfully to '${newUsername}' / '${newPassword}'.`);
            console.log('User ID:', result.rows[0].id);
        } else {
            console.log(`Target user not found (checked for ${oldEmail} or ${newUsername}).`);
            // Try to insert if not exists (optional, but good for robustness if previous steps failed)
        }

    } catch (err) {
        if (err.code === '42703') { // Undefined column 'username'
            console.log("Column 'username' does not exist, updating only 'email'.");
            try {
                const oldEmail = 'test@example.com';
                const newUsername = 'admin';
                const newPassword = 'admin123';
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                const result = await client.query(
                    'UPDATE users SET email = $1, password_hash = $2 WHERE email = $3 OR email = $1 RETURNING id, email',
                    [newUsername, hashedPassword, oldEmail]
                );
                if (result.rowCount > 0) {
                    console.log(`User updated successfully (email only) to '${newUsername}' / '${newPassword}'.`);
                }
            } catch (retryErr) {
                console.error('Retry Error:', retryErr);
            }
        } else {
            console.error('Error:', err);
        }
    } finally {
        await client.end();
    }
};

updateToAdmin();
