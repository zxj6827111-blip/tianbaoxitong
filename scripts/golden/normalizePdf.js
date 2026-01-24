const fs = require('node:fs/promises');

const normalizePdf = (buffer) => {
  const text = buffer.toString('binary');
  const stripped = text
    .replace(/\/CreationDate\s*\(.*?\)/g, '')
    .replace(/\/ModDate\s*\(.*?\)/g, '')
    .replace(/\/ID\s*\[[^\]]*\]/g, '')
    .replace(/\/Producer\s*\(.*?\)/g, '')
    .replace(/\/Creator\s*\(.*?\)/g, '');
  return Buffer.from(stripped, 'binary');
};

const hashNormalizedPdf = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const normalized = normalizePdf(buffer);
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

module.exports = {
  normalizePdf,
  hashNormalizedPdf
};
