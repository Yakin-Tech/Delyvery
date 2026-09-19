const { Router } = require('express');
const staffController = require('../controllers/staff.controller');
const staffValidator = require('../validators/staff.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/', staffController.list);
router.post('/', staffValidator.createStaff, validate, staffController.create);
router.patch('/:id', staffValidator.updateStaff, validate, staffController.update);
router.post('/:id/reset-password', staffValidator.resetPassword, validate, staffController.resetPassword);

module.exports = router;
