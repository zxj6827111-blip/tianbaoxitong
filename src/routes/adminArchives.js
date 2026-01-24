const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { requireAuth, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const db = require('../db');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/archives');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      return cb(new AppError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only PDF files are allowed'
      }));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Upload Annual Report PDF
router.post('/upload', requireAuth, requireRole(['admin', 'maintainer']), upload.single('file'), async (req, res, next) => {
  const client = await db.getClient();
  try {
    if (!req.file) {
      throw new AppError({
        statusCode: 400,
        code: 'FILE_REQUIRED',
        message: 'PDF file is required'
      });
    }

    const { department_id, year, report_type } = req.body;

    if (!department_id || !year || !report_type) {
      // Clean up uploaded file
      await fs.unlink(req.file.path);
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'department_id, year, and report_type are required'
      });
    }

    // Calculate file hash
    const fileBuffer = await fs.readFile(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    await client.query('BEGIN');

    // Insert report metadata
    const reportResult = await client.query(
      `INSERT INTO org_dept_annual_report 
       (department_id, year, report_type, file_name, file_path, file_hash, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (department_id, year, report_type)
       DO UPDATE SET 
         file_name = EXCLUDED.file_name,
         file_path = EXCLUDED.file_path,
         file_hash = EXCLUDED.file_hash,
         file_size = EXCLUDED.file_size,
         uploaded_by = EXCLUDED.uploaded_by,
         updated_at = NOW()
       RETURNING *`,
      [
        department_id,
        parseInt(year),
        report_type,
        req.file.originalname,
        req.file.path,
        fileHash,
        req.file.size,
        req.user.id
      ]
    );

    const report = reportResult.rows[0];

    // Extract text from PDF
    let extractedText = '';
    try {
      const pdfData = await pdfParse(fileBuffer);
      extractedText = pdfData.text;
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      // Continue even if PDF parsing fails
    }

    // Store full extracted text as 'RAW' category for manual editing
    if (extractedText) {
      await client.query(
        `INSERT INTO org_dept_text_content 
         (department_id, year, category, content_text, source_report_id, created_by)
         VALUES ($1, $2, 'RAW', $3, $4, $5)
         ON CONFLICT (department_id, year, category)
         DO UPDATE SET 
           content_text = EXCLUDED.content_text,
           source_report_id = EXCLUDED.source_report_id,
           updated_at = NOW()`,
        [department_id, parseInt(year), extractedText, report.id, req.user.id]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      report,
      extracted_text_length: extractedText.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    // Clean up file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    return next(error);
  } finally {
    client.release();
  }
});

// Get Archives for Department/Year
router.get('/departments/:deptId/years/:year', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { deptId, year } = req.params;

    // Get reports
    const reportsResult = await db.query(
      `SELECT * FROM org_dept_annual_report
       WHERE department_id = $1 AND year = $2
       ORDER BY report_type`,
      [deptId, parseInt(year)]
    );

    // Get text content
    const textResult = await db.query(
      `SELECT * FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2
       ORDER BY category`,
      [deptId, parseInt(year)]
    );

    return res.json({
      reports: reportsResult.rows,
      text_content: textResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

// Save/Update Text Content
router.post('/text-content', requireAuth, requireRole(['admin', 'maintainer']), async (req, res, next) => {
  try {
    const { department_id, year, category, content_text } = req.body;

    if (!department_id || !year || !category || !content_text) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'department_id, year, category, and content_text are required'
      });
    }

    const result = await db.query(
      `INSERT INTO org_dept_text_content 
       (department_id, year, category, content_text, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (department_id, year, category)
       DO UPDATE SET 
         content_text = EXCLUDED.content_text,
         updated_at = NOW()
       RETURNING *`,
      [department_id, parseInt(year), category, content_text, req.user.id]
    );

    return res.json({ text_content: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Get Text Content by Category (for reuse in Workbench)
router.get('/text-content/:deptId/:year/:category', requireAuth, async (req, res, next) => {
  try {
    const { deptId, year, category } = req.params;

    const result = await db.query(
      `SELECT content_text FROM org_dept_text_content
       WHERE department_id = $1 AND year = $2 AND category = $3`,
      [deptId, parseInt(year), category]
    );

    if (result.rows.length === 0) {
      return res.json({ content_text: null });
    }

    return res.json({ content_text: result.rows[0].content_text });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
