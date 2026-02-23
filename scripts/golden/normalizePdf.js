const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { PDFParse } = require('pdf-parse');

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

const normalizeExtractedText = (text) => String(text || '')
  .replace(/\r\n/g, '\n')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<UUID>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO_DATETIME>')
  .replace(/\d{4}年\d{1,2}月\d{1,2}日/g, '<DATE>')
  .replace(/\s+/g, '')
  .trim();

const hashNormalizedPdf = async (filePath) => {
  const buffer = await fs.readFile(filePath);

  let parser = null;
  try {
    parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText({ parsePageInfo: false });
    const normalizedText = normalizeExtractedText(textResult?.text || '');
    if (normalizedText) {
      return crypto.createHash('sha256').update(normalizedText, 'utf8').digest('hex');
    }
  } catch {
    // Fallback to binary metadata stripping when text extraction fails.
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }

  const normalizedBinary = normalizePdf(buffer);
  return crypto.createHash('sha256').update(normalizedBinary).digest('hex');
};

module.exports = {
  normalizePdf,
  hashNormalizedPdf
};
