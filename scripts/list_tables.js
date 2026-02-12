const { Client } = require('pg');
require('dotenv').config();

const listTables = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();
        console.log('Connected to database.\n');

        const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

        console.log('Tables in public schema:');
        if (res.rows.length === 0) {
            console.log('No tables found.');
        } else {
            res.rows.forEach(row => console.log(` - ${row.table_name}`));
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

listTables();
