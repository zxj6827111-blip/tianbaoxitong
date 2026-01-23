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
  return res.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected error occurred'
  });
};

module.exports = {
  AppError,
  errorHandler
};
