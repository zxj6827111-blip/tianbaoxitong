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
        console.log(`Target Department: ${deptRes.rows[0].name} (${deptId})`);

        // Find associated units
        const unitsRes = await client.query('SELECT id FROM org_unit WHERE department_id = $1', [deptId]);
        const unitIds = unitsRes.rows.map(r => r.id);

        if (unitIds.length > 0) {
            console.log(`Found ${unitIds.length} units to clean up.`);

            // 1. Unlink Users
            await client.query('UPDATE users SET unit_id = NULL WHERE unit_id = ANY($1)', [unitIds]);
            console.log(' - Unlinked users.');

            // 2. Delete Correction Suggestions
            await client.query('DELETE FROM correction_suggestion WHERE unit_id = ANY($1)', [unitIds]);
            console.log(' - Deleted correction suggestions.');

            // 3. Delete History Actuals
            await client.query('DELETE FROM history_actuals WHERE unit_id = ANY($1)', [unitIds]);
            console.log(' - Deleted history actuals.');

            // 4. Delete Facts Budget
            await client.query('DELETE FROM facts_budget WHERE unit_id = ANY($1)', [unitIds]);
            console.log(' - Deleted facts budget.');

            // 5. Delete Report Drafts (and lines if constraints exist)
            // First delete lines if necessary (assuming table report_draft_line_item exists and references draft)
            // Let's first get draft IDs to be safe
            const draftsRes = await client.query('SELECT id FROM report_draft WHERE unit_id = ANY($1)', [unitIds]);
            const draftIds = draftsRes.rows.map(d => d.id);
            if (draftIds.length > 0) {
                // Try to delete from line items if table exists. 
                // I'll just try/catch this part or generic delete from report_draft expecting CASCADE or manual delete.
                // Let's assuming checking table existence is too slow, just try delete.
                try {
                    await client.query('DELETE FROM report_draft_line_item WHERE draft_id = ANY($1)', [draftIds]);
                    console.log(' - Deleted report draft line items.');
                } catch (e) {
                    // Table might not exist or name might be different.
                    console.log(' - (Skipped/Failed line item delete, maybe not needed or table mismatch)');
                }
                await client.query('DELETE FROM report_draft WHERE id = ANY($1)', [draftIds]);
                console.log(' - Deleted report drafts.');
            }

            // 6. Delete Upload Jobs
            await client.query('DELETE FROM upload_job WHERE unit_id = ANY($1)', [unitIds]);
            console.log(' - Deleted upload jobs.');

            // 7. Finally Delete Units
            await client.query('DELETE FROM org_unit WHERE id = ANY($1)', [unitIds]);
            console.log(' - Deleted units.');
        }

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
