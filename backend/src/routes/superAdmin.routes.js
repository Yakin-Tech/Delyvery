const { Router } = require('express');
const superAdminController = require('../controllers/superAdmin.controller');
const superAdminValidator = require('../validators/superAdmin.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('super_admin'));

router.get('/stats', superAdminController.stats);
router.get('/stats/timeseries', superAdminController.timeseries);
router.get('/stats/activity', superAdminController.activityStats);
router.get('/stats/errors', superAdminController.errorStats);
router.get('/stats/onboarding-funnel', superAdminController.onboardingFunnel);
router.get('/stats/top-orgs', superAdminController.topOrgsByVolume);
router.get('/audit-log', superAdminController.listAuditLog);

router.get('/organizations', superAdminController.listOrganizations);
router.post('/organizations', superAdminValidator.createOrganization, validate, superAdminController.createOrganization);
router.get('/organizations/:id', superAdminController.getOrganization);
router.patch('/organizations/:id', superAdminValidator.updateOrganization, validate, superAdminController.updateOrganization);
router.post('/organizations/:id/admins', superAdminValidator.createOrgAdmin, validate, superAdminController.createOrgAdmin);
router.patch('/organizations/:orgId/admins/:userId', superAdminValidator.updateOrgAdminStatus, validate, superAdminController.updateOrgAdminStatus);
router.post('/organizations/:orgId/admins/:userId/reset-password', superAdminValidator.resetOrgAdminPassword, validate, superAdminController.resetOrgAdminPassword);
router.post('/organizations/:id/impersonate', superAdminValidator.impersonate, validate, superAdminController.impersonate);

module.exports = router;
