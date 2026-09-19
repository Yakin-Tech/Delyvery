const { Router } = require('express');
const paymentController = require('../controllers/payment.controller');
const paymentValidator = require('../validators/payment.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const staffOnlyInVehicleOrgs = require('../middleware/staffOnlyInVehicleOrgs');

const router = Router();

// Org admins always; office staff only in vehicle_eod orgs (see the middleware).
router.use(authenticate, requireRole('org_admin', 'staff'), staffOnlyInVehicleOrgs);

router.post('/', paymentValidator.createPayment, validate, paymentController.create);

module.exports = router;
