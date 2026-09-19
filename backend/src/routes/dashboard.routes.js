const { Router } = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/', dashboardController.getDashboard);

module.exports = router;
