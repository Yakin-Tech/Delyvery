const { Router } = require('express');
const reportsController = require('../controllers/reports.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/', reportsController.listReportNames);
router.get('/:name', reportsController.getReport);
router.get('/:name/export.csv', reportsController.exportReportCsv);

module.exports = router;
