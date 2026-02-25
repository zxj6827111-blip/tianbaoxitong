const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const adminOrgRoutes = require('./routes/adminOrg');
const adminPdfBatchRoutes = require('./routes/adminPdfBatch');
const adminUserRoutes = require('./routes/adminUsers');
const adminArchivesRoutes = require('./routes/adminArchives');
const adminSuggestionRoutes = require('./routes/adminSuggestions');
const adminHistoryRoutes = require('./routes/adminHistory');
const metricsRoutes = require('./routes/metrics');
const historyRoutes = require('./routes/history');
const uploadRoutes = require('./routes/uploads');
const draftRoutes = require('./routes/drafts');
const reportVersionRoutes = require('./routes/reportVersions');
const finalRoutes = require('./routes/final');
const { AppError, errorHandler } = require('./errors');
const logger = require('./services/logger');

const app = express();
app.set('query parser', 'simple');
if (process.env.TRUST_PROXY) {
  // Example values: "1", "loopback", "true".
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
}

// Request trace id for end-to-end correlation across logs and API responses.
app.use((req, res, next) => {
  const incomingId = String(req.headers['x-request-id'] || '').trim();
  const requestId = incomingId || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'];
const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const allowedCorsOrigins = configuredCorsOrigins.length > 0 ? configuredCorsOrigins : DEFAULT_CORS_ORIGINS;

// CORS配置 - 允许前端访问
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, allowedCorsOrigins.includes(origin));
  },
  credentials: true
}));

// Baseline browser hardening headers for API responses.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.json());

// Global Request Logger (default: concise, one line per non-health request)
app.use((req, res, next) => {
  if (process.env.REQUEST_LOG === 'off') {
    return next();
  }

  if (req.path === '/api/health' || req.path === '/metrics' || req.method === 'OPTIONS') {
    return next();
  }

  const start = Date.now();
  const requestLogFormat = String(process.env.REQUEST_LOG_FORMAT || 'json').toLowerCase();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const userId = req.user?.id || null;
    const requestMeta = {
      request_id: req.requestId || null,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: durationMs,
      ip: req.ip || null,
      user_id: userId,
      user_agent: req.headers['user-agent'] || null
    };

    if (requestLogFormat !== 'json') {
      const line = `[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms) req_id=${req.requestId}`;
      if (res.statusCode >= 500) {
        console.error(line);
      } else if (res.statusCode >= 400) {
        console.warn(line);
      } else {
        console.log(line);
      }
      return;
    }

    if (res.statusCode >= 500) {
      logger.error('http_request', requestMeta);
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn('http_request', requestMeta);
      return;
    }
    logger.info('http_request', requestMeta);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/metrics', metricsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/org', adminOrgRoutes);
app.use('/api/admin/pdf-batch', adminPdfBatchRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/archives', adminArchivesRoutes);
app.use('/api/admin/suggestions', adminSuggestionRoutes);
app.use('/api/admin/history', adminHistoryRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/drafts', draftRoutes);
app.use('/api/report_versions', reportVersionRoutes);
app.use('/api/final', finalRoutes);

app.use((req, res, next) => {
  return next(new AppError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Route not found'
  }));
});

app.use(errorHandler);

module.exports = app;
