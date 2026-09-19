const { Router } = require('express');
const vehicleController = require('../controllers/vehicle.controller');
const vehicleValidator = require('../validators/vehicle.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate);

// Staff need the list to pick a vehicle when keying in an end-of-day note;
// only the org admin manages the fleet itself.
router.get('/', requireRole('org_admin', 'staff'), vehicleController.list);
router.post('/', requireRole('org_admin'), vehicleValidator.createVehicle, validate, vehicleController.create);
router.patch('/:id', requireRole('org_admin'), vehicleValidator.updateVehicle, validate, vehicleController.update);

module.exports = router;
