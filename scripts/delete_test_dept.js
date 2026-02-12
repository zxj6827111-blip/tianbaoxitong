const { Client } = require('pg');
require('dotenv').config();

const deleteTestDept = async () => {
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

        // Delete associated units
        const deleteUnitsRes = await client.query('DELETE FROM org_unit WHERE department_id = $1', [deptId]);
        console.log(`Deleted ${deleteUnitsRes.rowCount} units associated with Test Department.`);

        // Delete the department
        const deleteDeptRes = await client.query('DELETE FROM org_department WHERE id = $1', [deptId]);
        console.log(`Deleted Test Department (Row count: ${deleteDeptRes.rowCount}).`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
};

deleteTestDept();
