class AppError extends Error {
  constructor({ statusCode, code, message, details }) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    const payload = {
      code: err.code,
      message: err.message
    };

    if (err.details) {
      payload.details = err.details;
    }

    return res.status(err.statusCode).json(payload);
  }

  console.error(err);

  // For debugging: return actual error message
  // In production this should be sanitized
  return res.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'Unexpected error occurred',
    detail: err.detail // Postgres specific
  });
};

module.exports = {
  AppError,
  errorHandler
};
