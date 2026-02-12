const { Client } = require('pg');
require('dotenv').config();

const checkTestDept = async () => {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/govbudget',
    });

    try {
        await client.connect();

        // Find Test Department
        const deptRes = await client.query("SELECT id, name FROM org_department WHERE name = 'Test Department'");
        if (deptRes.rows.length === 0) {
            console.log('Test Department not found.');
            return;
        }
        const deptId = deptRes.rows[0].id;
        console.log(`Found Department: ${deptRes.rows[0].name} (ID: ${deptId})`);

        // Find associated units
        const unitsRes = await client.query('SELECT id, name FROM org_unit WHERE department_id = $1', [deptId]);
        console.log(`Found ${unitsRes.rows.length} units in this department:`);
        unitsRes.rows.forEach(u => console.log(` - ${u.name} (ID: ${u.id})`));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

checkTestDept();
