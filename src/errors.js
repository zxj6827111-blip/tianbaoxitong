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

  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 'FILE_TOO_LARGE',
        message: 'Uploaded file exceeds maximum allowed size'
      });
    }

    return res.status(400).json({
      code: 'UPLOAD_ERROR',
      message: 'File upload failed'
    });
  }

  console.error(err);

  const payload = {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected error occurred'
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
