const { Client } = require('pg');
require('dotenv').config();

const checkDepartments = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();
        console.log('Connected to database.\n');

        // Count units
        const unitsCount = await client.query('SELECT COUNT(*) FROM units');
        console.log(`Total Units: ${unitsCount.rows[0].count}`);

        // List first 5 units
        const unitsList = await client.query('SELECT id, name, code FROM units LIMIT 5');
        if (unitsList.rows.length > 0) {
            console.log('Sample Units:');
            unitsList.rows.forEach(u => console.log(` - ${u.name} (${u.code})`));
        } else {
            console.log('No units found.');
        }
        console.log('\n');

        // Count departments
        const deptsCount = await client.query('SELECT COUNT(*) FROM departments');
        console.log(`Total Departments: ${deptsCount.rows[0].count}`);

        // List first 5 departments
        const deptsList = await client.query('SELECT id, name, code, unit_id FROM departments LIMIT 5');
        if (deptsList.rows.length > 0) {
            console.log('Sample Departments:');
            deptsList.rows.forEach(d => console.log(` - ${d.name} (Code: ${d.code}, Unit ID: ${d.unit_id})`));
        } else {
            console.log('No departments found.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

checkDepartments();
