const path = require('node:path');
const { execSync } = require('node:child_process');

const binName = process.platform === 'win32' ? 'node-pg-migrate.cmd' : 'node-pg-migrate';
const binPath = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', binName);
const migrationsDir = path.resolve(__dirname, '..', '..', 'db', 'migrations');

const migrateUp = () => {
  execSync(`"${binPath}" up -m "${migrationsDir}"`, {
    stdio: 'inherit',
    env: process.env
  });
};

const migrateDown = () => {
  execSync(`"${binPath}" down -m "${migrationsDir}" --count 1`, {
    stdio: 'inherit',
    env: process.env
  });
};

module.exports = {
  migrateUp,
  migrateDown
};
