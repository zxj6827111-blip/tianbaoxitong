const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDepartmentTreeWithCounts, listUnits } = require('../repositories/orgRepository');

const router = express.Router();

router.get('/_demo/departments', requireAuth, requireRole(['admin', 'maintainer']), async (req, res) => {
  const departments = await getDepartmentTreeWithCounts();
  return res.json({ departments });
});

router.get('/_demo/units', requireAuth, requireRole(['admin', 'maintainer']), async (req, res) => {
  const units = await listUnits({
    page: req.query.page,
    pageSize: req.query.pageSize,
    departmentId: req.query.departmentId,
    q: req.query.q,
    sortBy: req.query.sortBy,
    sortOrder: req.query.sortOrder
  });

  return res.json({ units });
});

module.exports = router;
