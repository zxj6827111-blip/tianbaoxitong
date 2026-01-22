const express = require('express');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { AppError, errorHandler } = require('./errors');

const app = express();

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.post('/api/reports/:draftId/generate', (req, res, next) => {
  return next(new AppError({
    statusCode: 400,
    code: 'GENERATE_FORBIDDEN',
    message: 'Fatal validation issues prevent report generation'
  }));
});

app.use((req, res, next) => {
  return next(new AppError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Route not found'
  }));
});

app.use(errorHandler);

module.exports = app;
