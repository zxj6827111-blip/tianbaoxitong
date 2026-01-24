const db = require('../../src/db');

const resetDb = async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
};

module.exports = {
    resetDb
};
