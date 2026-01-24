const express = require('express');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const adminSuggestionRoutes = require('./routes/adminSuggestions');
const adminHistoryRoutes = require('./routes/adminHistory');
const historyRoutes = require('./routes/history');
const uploadRoutes = require('./routes/uploads');
const draftRoutes = require('./routes/drafts');
const { AppError, errorHandler } = require('./errors');

const app = express();

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/suggestions', adminSuggestionRoutes);
app.use('/api/admin/history', adminHistoryRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/drafts', draftRoutes);

app.use((req, res, next) => {
  return next(new AppError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Route not found'
  }));
});

app.use(errorHandler);

module.exports = app;
