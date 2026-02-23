const { createClient } = require('redis');
const db = require('../db');
const logger = require('./logger');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CREDENTIAL_MAX = 8;
const DEFAULT_IP_MAX = 200;
const DEFAULT_DB_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
const CREDENTIAL_LIMIT_MAX = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_CREDENTIAL_MAX, DEFAULT_CREDENTIAL_MAX);
const IP_LIMIT_MAX = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_IP_MAX, DEFAULT_IP_MAX);
const DB_CLEANUP_INTERVAL_MS = parsePositiveInt(
  process.env.LOGIN_RATE_LIMIT_DB_CLEANUP_INTERVAL_MS,
  DEFAULT_DB_CLEANUP_INTERVAL_MS
);
const RATE_LIMIT_KEY_PREFIX = String(process.env.LOGIN_RATE_LIMIT_REDIS_PREFIX || 'govbudget:login_rl');
const RATE_LIMIT_BACKEND = String(process.env.LOGIN_RATE_LIMIT_BACKEND || 'auto').toLowerCase();

let dbCleanupTimer = null;
let redisClient = null;
let redisInitPromise = null;
let dbCleanupDisabled = false;
let dbBucketTableMissing = false;

const normalizeIp = (ip) => String(ip || 'unknown').trim() || 'unknown';
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const isMissingBucketTableError = (error) => {
  if (String(error?.code || '') === '42P01') {
    return true;
  }

  const message = String(error?.message || '');
  return message.includes('login_rate_limit_bucket');
};

const markDbBucketTableMissing = (error, source) => {
  if (dbBucketTableMissing) {
    return;
  }

  dbBucketTableMissing = true;
  dbCleanupDisabled = true;
  stopLoginRateLimitCleanupJob();
  logger.warn('login_rate_limit_db_backend_unavailable_missing_table', { source, error });
};

const shouldUseRedis = () => {
  if (RATE_LIMIT_BACKEND === 'db') {
    return false;
  }
  if (RATE_LIMIT_BACKEND === 'redis') {
    return true;
  }
  return Boolean(process.env.REDIS_URL);
};

const ensureRedisClient = async () => {
  if (!shouldUseRedis()) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  if (redisInitPromise) {
    return redisInitPromise;
  }

  redisInitPromise = (async () => {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 1500
      }
    });

    client.on('error', (error) => {
      logger.warn('redis_client_error', { component: 'login_rate_limiter', error });
    });

    try {
      await client.connect();
      redisClient = client;
      logger.info('login_rate_limiter_backend_ready', { backend: 'redis' });
      return redisClient;
    } catch (error) {
      logger.warn('login_rate_limiter_redis_unavailable_fallback_db', { error });
      try {
        await client.quit();
      } catch {
        // Ignore redis quit failures during failed init.
      }
      return null;
    } finally {
      redisInitPromise = null;
    }
  })();

  return redisInitPromise;
};

const toRetryAfterSecondsFromTtlMs = (ttlMs) => Math.max(1, Math.ceil(Number(ttlMs || 0) / 1000));

const buildLoginRateLimitKeys = ({ ip, email }) => {
  const normalizedIp = normalizeIp(ip);
  const normalizedEmail = normalizeEmail(email) || '-';

  return {
    credentialKey: `${RATE_LIMIT_KEY_PREFIX}:credential:${normalizedIp}:${normalizedEmail}`,
    ipKey: `${RATE_LIMIT_KEY_PREFIX}:ip:${normalizedIp}`
  };
};

const checkLoginRateLimitInRedis = async ({ credentialKey, ipKey }) => {
  const client = await ensureRedisClient();
  if (!client) {
    return null;
  }

  const [credentialAttemptsRaw, ipAttemptsRaw] = await client.mGet([credentialKey, ipKey]);
  const [credentialTtlMs, ipTtlMs] = await Promise.all([
    client.pTTL(credentialKey),
    client.pTTL(ipKey)
  ]);

  const credentialAttempts = Number(credentialAttemptsRaw || 0);
  if (credentialAttempts >= CREDENTIAL_LIMIT_MAX && credentialTtlMs > 0) {
    return {
      blocked: true,
      retryAfterSeconds: toRetryAfterSecondsFromTtlMs(credentialTtlMs)
    };
  }

  const ipAttempts = Number(ipAttemptsRaw || 0);
  if (ipAttempts >= IP_LIMIT_MAX && ipTtlMs > 0) {
    return {
      blocked: true,
      retryAfterSeconds: toRetryAfterSecondsFromTtlMs(ipTtlMs)
    };
  }

  return {
    blocked: false,
    retryAfterSeconds: 0
  };
};

const checkLoginRateLimitInDb = async ({ credentialKey, ipKey }) => {
  if (dbBucketTableMissing) {
    return {
      blocked: false,
      retryAfterSeconds: 0
    };
  }

  const nowMs = Date.now();

  let result;
  try {
    result = await db.query(
      `SELECT bucket_key, attempts, reset_at
       FROM login_rate_limit_bucket
       WHERE bucket_key = ANY($1)
         AND reset_at > now()`,
      [[credentialKey, ipKey]]
    );
  } catch (error) {
    if (isMissingBucketTableError(error)) {
      markDbBucketTableMissing(error, 'check');
      return {
        blocked: false,
        retryAfterSeconds: 0
      };
    }
    throw error;
  }

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.bucket_key, {
      attempts: Number(row.attempts),
      resetAt: row.reset_at
    });
  }

  const toRetryAfterSeconds = (resetAt) => {
    const resetMs = resetAt instanceof Date ? resetAt.getTime() : Number(new Date(resetAt).getTime());
    return Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
  };

  const credentialBucket = map.get(credentialKey);
  if (credentialBucket && credentialBucket.attempts >= CREDENTIAL_LIMIT_MAX) {
    return {
      blocked: true,
      retryAfterSeconds: toRetryAfterSeconds(credentialBucket.resetAt)
    };
  }

  const ipBucket = map.get(ipKey);
  if (ipBucket && ipBucket.attempts >= IP_LIMIT_MAX) {
    return {
      blocked: true,
      retryAfterSeconds: toRetryAfterSeconds(ipBucket.resetAt)
    };
  }

  return {
    blocked: false,
    retryAfterSeconds: 0
  };
};

const incrementRedisBucket = async (client, bucketKey) => {
  const attempts = await client.incr(bucketKey);
  if (attempts === 1) {
    await client.pExpire(bucketKey, RATE_LIMIT_WINDOW_MS);
  }
};

const registerLoginFailureInRedis = async ({ credentialKey, ipKey }) => {
  const client = await ensureRedisClient();
  if (!client) {
    return false;
  }

  await incrementRedisBucket(client, credentialKey);
  await incrementRedisBucket(client, ipKey);
  return true;
};

const registerLoginFailureInDb = async ({ credentialKey, ipKey }) => {
  if (dbBucketTableMissing) {
    return;
  }

  await incrementDbBucket({ bucketKey: credentialKey, scope: 'CREDENTIAL' });
  await incrementDbBucket({ bucketKey: ipKey, scope: 'IP' });
};

const incrementDbBucket = async ({ bucketKey, scope }) => {
  try {
    await db.query(
      `INSERT INTO login_rate_limit_bucket AS b (bucket_key, scope, attempts, reset_at, updated_at)
       VALUES ($1, $2, 1, now() + ($3::bigint * interval '1 millisecond'), now())
       ON CONFLICT (bucket_key)
       DO UPDATE SET
         attempts = CASE WHEN b.reset_at <= now() THEN 1 ELSE b.attempts + 1 END,
         reset_at = CASE
           WHEN b.reset_at <= now() THEN now() + ($3::bigint * interval '1 millisecond')
           ELSE b.reset_at
         END,
         updated_at = now()`,
      [bucketKey, scope, RATE_LIMIT_WINDOW_MS]
    );
  } catch (error) {
    if (isMissingBucketTableError(error)) {
      markDbBucketTableMissing(error, 'increment');
      return;
    }
    throw error;
  }
};

const clearLoginFailuresInRedis = async ({ credentialKey, ipKey }) => {
  const client = await ensureRedisClient();
  if (!client) {
    return false;
  }

  const keys = [credentialKey, ipKey].filter(Boolean);
  if (keys.length > 0) {
    await client.del(keys);
  }
  return true;
};

const clearLoginFailuresInDb = async ({ credentialKey, ipKey }) => {
  if (dbBucketTableMissing) {
    return;
  }

  const keys = [credentialKey, ipKey].filter(Boolean);
  if (keys.length === 0) return;

  try {
    await db.query(
      `DELETE FROM login_rate_limit_bucket
       WHERE bucket_key = ANY($1)`,
      [keys]
    );
  } catch (error) {
    if (isMissingBucketTableError(error)) {
      markDbBucketTableMissing(error, 'clear');
      return;
    }
    throw error;
  }
};

const cleanupExpiredBucketsInDb = async () => {
  if (dbBucketTableMissing) {
    return;
  }

  try {
    await db.query(
      `DELETE FROM login_rate_limit_bucket
       WHERE reset_at <= now()`
    );
  } catch (error) {
    if (isMissingBucketTableError(error)) {
      markDbBucketTableMissing(error, 'cleanup');
      return;
    }
    throw error;
  }
};

const checkLoginRateLimit = async ({ credentialKey, ipKey }) => {
  const redisResult = await checkLoginRateLimitInRedis({ credentialKey, ipKey });
  if (redisResult) {
    return redisResult;
  }
  return checkLoginRateLimitInDb({ credentialKey, ipKey });
};

const registerLoginFailure = async ({ credentialKey, ipKey }) => {
  const redisDone = await registerLoginFailureInRedis({ credentialKey, ipKey });
  if (redisDone) {
    return;
  }
  await registerLoginFailureInDb({ credentialKey, ipKey });
};

const clearLoginFailures = async ({ credentialKey, ipKey }) => {
  const redisDone = await clearLoginFailuresInRedis({ credentialKey, ipKey });
  if (redisDone) {
    return;
  }
  await clearLoginFailuresInDb({ credentialKey, ipKey });
};

const resetRedisRateLimitStore = async () => {
  const client = await ensureRedisClient();
  if (!client) return false;

  const pattern = `${RATE_LIMIT_KEY_PREFIX}:*`;
  let cursor = '0';
  do {
    const scanResult = await client.scan(cursor, {
      MATCH: pattern,
      COUNT: 200
    });
    cursor = String(scanResult.cursor || '0');
    const keys = Array.isArray(scanResult.keys) ? scanResult.keys : [];
    if (keys.length > 0) {
      await client.del(keys);
    }
  } while (cursor !== '0');

  return true;
};

const resetLoginRateLimitStore = async () => {
  const redisDone = await resetRedisRateLimitStore();
  if (redisDone) {
    return;
  }
  if (dbBucketTableMissing) {
    return;
  }

  try {
    await db.query('DELETE FROM login_rate_limit_bucket');
  } catch (error) {
    if (isMissingBucketTableError(error)) {
      markDbBucketTableMissing(error, 'reset');
      return;
    }
    throw error;
  }
};

const runDbCleanupJob = async () => {
  if (dbCleanupDisabled) {
    return;
  }

  try {
    await cleanupExpiredBucketsInDb();
  } catch (error) {
    if (isMissingBucketTableError(error)) {
      markDbBucketTableMissing(error, 'cleanup_job');
    } else {
      logger.warn('login_rate_limit_db_cleanup_failed', { error });
    }
  }
};

const startLoginRateLimitCleanupJob = () => {
  if (RATE_LIMIT_BACKEND === 'redis') {
    return;
  }

  if (dbCleanupTimer) {
    return;
  }

  void runDbCleanupJob();
  dbCleanupTimer = setInterval(() => {
    void runDbCleanupJob();
  }, DB_CLEANUP_INTERVAL_MS);
  dbCleanupTimer.unref();
};

const stopLoginRateLimitCleanupJob = () => {
  if (!dbCleanupTimer) {
    return;
  }

  clearInterval(dbCleanupTimer);
  dbCleanupTimer = null;
};

const shutdownLoginRateLimiter = async () => {
  stopLoginRateLimitCleanupJob();
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      // Ignore redis shutdown errors.
    } finally {
      redisClient = null;
    }
  }
};

module.exports = {
  buildLoginRateLimitKeys,
  checkLoginRateLimit,
  registerLoginFailure,
  clearLoginFailures,
  resetLoginRateLimitStore,
  startLoginRateLimitCleanupJob,
  stopLoginRateLimitCleanupJob,
  shutdownLoginRateLimiter
};
