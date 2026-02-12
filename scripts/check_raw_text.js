const db = require('../src/db');

async function checkRawText() {
    try {
        const res = await db.query("SELECT content_text FROM org_dept_text_content WHERE category = 'RAW' ORDER BY created_at DESC LIMIT 1");
        if (res.rows.length > 0) {
            console.log('--- DB RAW TEXT START ---');
            console.log(res.rows[0].content_text.substring(0, 2000));
            console.log('--- DB RAW TEXT END ---');
        } else {
            console.log('No RAW text found in DB');
        }
    } catch (err) {
        console.error('DB Error:', err);
    }
}

checkRawText();
