const { Client } = require('pg');
require('dotenv').config();

const checkTimestamps = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();
        console.log('Connected to database.\n');

        console.log('--- Departments ---');
        const depts = await client.query('SELECT name, created_at FROM org_department ORDER BY created_at DESC');
        if (depts.rows.length === 0) {
            console.log('No departments found.');
        } else {
            depts.rows.forEach(d => {
                console.log(`${d.name}: ${d.created_at}`);
            });
        }

        console.log('\n--- Units ---');
        const units = await client.query('SELECT name, created_at FROM org_unit ORDER BY created_at DESC');
        if (units.rows.length === 0) {
            console.log('No units found.');
        } else {
            units.rows.forEach(u => {
                console.log(`${u.name}: ${u.created_at}`);
            });
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

checkTimestamps();
