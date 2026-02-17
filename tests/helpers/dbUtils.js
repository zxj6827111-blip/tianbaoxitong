const db = require('../../src/db');

const resetDb = async () => {
    // 安全防护：绝对禁止在正式数据库上执行 DROP SCHEMA
    const dbNameResult = await db.query('SELECT current_database() AS db_name');
    const dbName = dbNameResult.rows[0].db_name;
    
    if (!dbName.includes('_test')) {
        throw new Error(
            `🚨 安全防护：拒绝在非测试数据库 "${dbName}" 上执行 resetDb()！` +
            `\n   resetDb() 仅允许在名称包含 "_test" 的数据库上运行。` +
            `\n   请检查 DATABASE_URL 和 TEST_DATABASE_URL 配置是否正确。`
        );
    }

    console.log(`[resetDb] 正在清空测试数据库: ${dbName}`);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
};

module.exports = {
    resetDb
};
