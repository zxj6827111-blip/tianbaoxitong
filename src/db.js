const { Pool } = require('pg');

const resolveConnectionString = () => {
  const appDbUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

  if (process.env.NODE_ENV === 'test') {
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required when NODE_ENV=test to protect non-test data');
    }
    if (process.env.APP_DATABASE_URL && testDbUrl === process.env.APP_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL');
    }
    return testDbUrl;
  }

  if (!appDbUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return appDbUrl;
};

const pool = new Pool({
  connectionString: resolveConnectionString()
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

module.exports = {
  pool,
  query,
  getClient
};
