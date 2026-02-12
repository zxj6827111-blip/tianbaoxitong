const { Client } = require('pg');
require('dotenv').config();

const findForeignKeys = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();

        const query = `
      SELECT
          tc.table_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name 
      FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
      WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name='org_unit';
    `;

        const res = await client.query(query);
        console.log('Tables referencing org_unit:');
        res.rows.forEach(row => {
            console.log(` - ${row.table_name}.${row.column_name}`);
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

findForeignKeys();
