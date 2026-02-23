const toObject = (value) => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value;
};

const sanitizeMeta = (meta) => {
  const source = toObject(meta);
  const out = {};
  for (const [key, val] of Object.entries(source)) {
    if (val instanceof Error) {
      out[key] = {
        name: val.name,
        message: val.message,
        stack: val.stack
      };
      continue;
    }
    out[key] = val;
  }
  return out;
};

const emit = (level, message, meta = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitizeMeta(meta)
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
};

module.exports = {
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta)
};
