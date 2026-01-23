const path = require('node:path');
const fs = require('node:fs/promises');

const uploadDir = path.resolve(process.cwd(), 'storage', 'uploads');

const ensureUploadDir = async () => {
  await fs.mkdir(uploadDir, { recursive: true });
};

const buildStoredFilename = (uploadId, originalName) => {
  const safeName = path.basename(originalName);
  return `${uploadId}__${safeName}`;
};

const getUploadFilePath = (uploadId, originalName) => {
  const storedName = buildStoredFilename(uploadId, originalName);
  return path.join(uploadDir, storedName);
};

module.exports = {
  uploadDir,
  ensureUploadDir,
  buildStoredFilename,
  getUploadFilePath
};
