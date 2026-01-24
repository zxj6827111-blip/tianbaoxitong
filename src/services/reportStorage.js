const path = require('node:path');
const fs = require('node:fs/promises');

const reportDir = path.resolve(process.cwd(), 'storage', 'reports');

const ensureReportDir = async () => {
  await fs.mkdir(reportDir, { recursive: true });
};

const buildReportFilename = ({ reportVersionId, suffix }) => `${reportVersionId}_${suffix}`;

const getReportFilePath = ({ reportVersionId, suffix }) =>
  path.join(reportDir, buildReportFilename({ reportVersionId, suffix }));

module.exports = {
  reportDir,
  ensureReportDir,
  buildReportFilename,
  getReportFilePath
};
