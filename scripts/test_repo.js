require('dotenv').config();
const { getDepartmentTreeWithCounts } = require('../src/repositories/orgRepository');

const testRepo = async () => {
    try {
        console.log('Testing getDepartmentTreeWithCounts with year=2024...');
        const depts = await getDepartmentTreeWithCounts({ year: 2024 });
        console.log(`Success! Retrieved ${depts.length} departments.`);
        depts.forEach(d => {
            console.log(` - ${d.name} (ID: ${d.id})`);
        });
    } catch (err) {
        console.error('Error in getDepartmentTreeWithCounts:', err);
    }
};

testRepo();
