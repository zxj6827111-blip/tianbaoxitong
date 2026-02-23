const logger = require('./services/logger');

class AppError extends Error {
  constructor({ statusCode, code, message, details }) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const errorHandler = (err, req, res, next) => {
  const requestId = req?.requestId || null;

  if (err instanceof AppError) {
    const payload = {
      code: err.code,
      message: err.message,
      request_id: requestId
    };

    if (err.details) {
      payload.details = err.details;
    }

    return res.status(err.statusCode).json(payload);
  }

  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 'FILE_TOO_LARGE',
        message: 'Uploaded file exceeds maximum allowed size',
        request_id: requestId
      });
    }

    return res.status(400).json({
      code: 'UPLOAD_ERROR',
      message: 'File upload failed',
      request_id: requestId
    });
  }

  logger.error('unhandled_error', {
    request_id: requestId,
    method: req?.method || null,
    path: req?.originalUrl || null,
    error: err
  });

  const payload = {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected error occurred',
    request_id: requestId
  };

  const exposeDebug = process.env.EXPOSE_ERROR_DETAILS === 'true';
  if (exposeDebug && process.env.NODE_ENV !== 'production') {
    payload.debug = {
      message: err.message || null,
      code: err.code || null,
      detail: err.detail || null
    };
  }

  return res.status(500).json(payload);
};

module.exports = {
  AppError,
  errorHandler
};
