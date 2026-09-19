const { Router } = require('express');
const organizationController = require('../controllers/organization.controller');
const organizationValidator = require('../validators/organization.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/', organizationController.getOwnOrganization);
router.patch('/', organizationValidator.updateOwnOrganization, validate, organizationController.updateOwnOrganization);
router.patch('/onboarding', organizationValidator.updateOnboarding, validate, organizationController.updateOnboarding);

module.exports = router;
