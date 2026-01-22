class AppError extends Error {
  constructor({ statusCode, code, message }) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message
    });
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
