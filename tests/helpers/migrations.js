const path = require('node:path');
const { execFileSync } = require('node:child_process');

const binPath = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'node-pg-migrate');
const migrationsDir = path.resolve(__dirname, '..', '..', 'db', 'migrations');

const migrateUp = () => {
  execFileSync(binPath, ['up', '-m', migrationsDir], {
    stdio: 'inherit',
    env: process.env
  });
};

const migrateDown = () => {
  execFileSync(binPath, ['down', '-m', migrationsDir, '--count', '1'], {
    stdio: 'inherit',
    env: process.env
  });
};

module.exports = {
  migrateUp,
  migrateDown
};
