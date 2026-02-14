require('dotenv').config();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Missing TEST_DATABASE_URL. Tests require an isolated test database.');
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL.');
}

// Force all test helpers (including node-pg-migrate CLI env) to use isolated test DB.
process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
