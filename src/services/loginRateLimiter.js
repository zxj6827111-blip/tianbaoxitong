const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CREDENTIAL_MAX = 8;
const DEFAULT_IP_MAX = 200;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
const CREDENTIAL_LIMIT_MAX = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_CREDENTIAL_MAX, DEFAULT_CREDENTIAL_MAX);
const IP_LIMIT_MAX = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_IP_MAX, DEFAULT_IP_MAX);

const buckets = new Map();
let lastCleanupAt = 0;

const normalizeIp = (ip) => String(ip || 'unknown').trim() || 'unknown';
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const getOrPurgeBucket = (key, now) => {
  const bucket = buckets.get(key);
  if (!bucket) {
    return null;
  }

  if (bucket.resetAt <= now) {
    buckets.delete(key);
    return null;
  }

  return bucket;
};

const cleanupExpiredBuckets = (now) => {
  if (buckets.size === 0) {
    return;
  }

  if (buckets.size < 2000 && now - lastCleanupAt < 30_000) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
  lastCleanupAt = now;
};

const incrementBucket = (key, now) => {
  const existing = getOrPurgeBucket(key, now);
  if (existing) {
    existing.count += 1;
    return existing;
  }

  const created = {
    count: 1,
    resetAt: now + RATE_LIMIT_WINDOW_MS
  };
  buckets.set(key, created);
  return created;
};

const toRetryAfterSeconds = (resetAt, now) => Math.max(1, Math.ceil((resetAt - now) / 1000));

const buildLoginRateLimitKeys = ({ ip, email }) => {
  const normalizedIp = normalizeIp(ip);
  const normalizedEmail = normalizeEmail(email) || '-';

  return {
    credentialKey: `login:credential:${normalizedIp}:${normalizedEmail}`,
    ipKey: `login:ip:${normalizedIp}`
  };
};

const checkLoginRateLimit = ({ credentialKey, ipKey }) => {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const credentialBucket = getOrPurgeBucket(credentialKey, now);
  if (credentialBucket && credentialBucket.count >= CREDENTIAL_LIMIT_MAX) {
    return {
      blocked: true,
      retryAfterSeconds: toRetryAfterSeconds(credentialBucket.resetAt, now)
    };
  }

  const ipBucket = getOrPurgeBucket(ipKey, now);
  if (ipBucket && ipBucket.count >= IP_LIMIT_MAX) {
    return {
      blocked: true,
      retryAfterSeconds: toRetryAfterSeconds(ipBucket.resetAt, now)
    };
  }

  return {
    blocked: false,
    retryAfterSeconds: 0
  };
};

const registerLoginFailure = ({ credentialKey, ipKey }) => {
  const now = Date.now();
  cleanupExpiredBuckets(now);
  incrementBucket(credentialKey, now);
  incrementBucket(ipKey, now);
};

const clearLoginFailures = ({ credentialKey, ipKey }) => {
  if (credentialKey) {
    buckets.delete(credentialKey);
  }
  if (ipKey) {
    buckets.delete(ipKey);
  }
};

const resetLoginRateLimitStore = () => {
  buckets.clear();
  lastCleanupAt = 0;
};

module.exports = {
  buildLoginRateLimitKeys,
  checkLoginRateLimit,
  registerLoginFailure,
  clearLoginFailures,
  resetLoginRateLimitStore
};
