const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const adminOrgRoutes = require('./routes/adminOrg');
const adminArchivesRoutes = require('./routes/adminArchives');
const adminSuggestionRoutes = require('./routes/adminSuggestions');
const adminHistoryRoutes = require('./routes/adminHistory');
const historyRoutes = require('./routes/history');
const uploadRoutes = require('./routes/uploads');
const draftRoutes = require('./routes/drafts');
const reportVersionRoutes = require('./routes/reportVersions');
const finalRoutes = require('./routes/final');
const { AppError, errorHandler } = require('./errors');

const app = express();

// CORS配置 - 允许前端访问
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'],
  credentials: true
}));

app.use(express.json());

// Global Request Logger (default: concise, one line per non-health request)
app.use((req, res, next) => {
  if (process.env.REQUEST_LOG === 'off') {
    return next();
  }

  if (req.path === '/api/health' || req.method === 'OPTIONS') {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const line = `[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`;
    if (res.statusCode >= 400) {
      console.warn(line);
    } else {
      console.log(line);
    }
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/org', adminOrgRoutes);
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
