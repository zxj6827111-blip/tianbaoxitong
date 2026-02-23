const dotenv = require('dotenv');

dotenv.config();

const { getJwtSecret } = require('./auth/jwt');
const app = require('./app');
const db = require('./db');
const logger = require('./services/logger');
const {
  startLoginRateLimitCleanupJob,
  shutdownLoginRateLimiter
} = require('./services/loginRateLimiter');

const port = process.env.PORT || 3000;

// Fail fast for weak JWT configuration in non-test environments.
getJwtSecret();
startLoginRateLimitCleanupJob();

const server = app.listen(port, () => {
  logger.info('server_started', { port: Number(port) });
});

const gracefulShutdown = async (signal) => {
  logger.info('graceful_shutdown_start', { signal });
  server.close(async (err) => {
    if (err) {
      logger.error('http_server_close_failed', { error: err });
    } else {
      logger.info('http_server_closed');
    }

    try {
      await shutdownLoginRateLimiter();
      logger.info('login_rate_limiter_shutdown');

      await db.pool.end();
      logger.info('database_pool_closed');
      process.exit(0);
    } catch (dbErr) {
      logger.error('graceful_shutdown_failed', { error: dbErr });
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
