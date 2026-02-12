const { Client } = require('pg');
require('dotenv').config();

const checkOrgData = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();
        console.log('Connected to database.\n');

        // Count org_unit
        const unitsCount = await client.query('SELECT COUNT(*) FROM org_unit');
        console.log(`Total Org Units: ${unitsCount.rows[0].count}`);

        // Count org_department
        const deptsCount = await client.query('SELECT COUNT(*) FROM org_department');
        console.log(`Total Org Departments: ${deptsCount.rows[0].count}`);

        if (parseInt(deptsCount.rows[0].count) === 0) {
            console.log('ALERT: org_department table is empty!');
        } else {
            const depts = await client.query('SELECT name FROM org_department LIMIT 5');
            console.log('Sample Departments:', depts.rows.map(d => d.name).join(', '));
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

checkOrgData();
