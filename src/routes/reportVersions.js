const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AppError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { getReportVersion } = require('../services/reportService');
const { reportDir } = require('../services/reportStorage');
const { getDraftOrThrow } = require('../services/validationEngine');

const router = express.Router();

const isPathInside = (targetPath, parentDir) => {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedParent = path.resolve(parentDir);
  const rel = path.relative(normalizedParent, normalizedTarget);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const sendFileOr404 = async (res, filePath, contentType, filename) => {
  if (!filePath) {
    throw new AppError({
      statusCode: 404,
      code: 'FILE_NOT_FOUND',
      message: 'Report file not found'
    });
  }

  const resolved = path.resolve(filePath);
  if (!isPathInside(resolved, reportDir)) {
    throw new AppError({
      statusCode: 404,
      code: 'FILE_NOT_FOUND',
      message: 'Report file not found'
    });
  }

  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(resolved);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new AppError({
        statusCode: 404,
        code: 'FILE_NOT_FOUND',
        message: 'Report file not found'
      });
    }
    throw error;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(fileBuffer);
};

const ensureReportAccess = async (reportVersion, user) => {
  await getDraftOrThrow(reportVersion.draft_id, user);
};

router.get('/:id/download/pdf', requireAuth, async (req, res, next) => {
  try {
    const reportVersion = await getReportVersion(req.params.id);
    if (!reportVersion) {
      throw new AppError({
        statusCode: 404,
        code: 'REPORT_VERSION_NOT_FOUND',
        message: 'Report version not found'
      });
    }
    await ensureReportAccess(reportVersion, req.user);
    return await sendFileOr404(res, reportVersion.pdf_path, 'application/pdf', 'report.pdf');
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/download/excel', requireAuth, async (req, res, next) => {
  try {
    const reportVersion = await getReportVersion(req.params.id);
    if (!reportVersion) {
      throw new AppError({
        statusCode: 404,
        code: 'REPORT_VERSION_NOT_FOUND',
        message: 'Report version not found'
      });
    }
    await ensureReportAccess(reportVersion, req.user);
    return await sendFileOr404(res, reportVersion.excel_path, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'report.xlsx');
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
