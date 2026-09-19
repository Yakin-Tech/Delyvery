const { Router } = require('express');
const customerController = require('../controllers/customer.controller');
const customerValidator = require('../validators/customer.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin', 'staff'));

router.get('/', customerController.list);
router.patch('/reorder', requireRole('org_admin'), customerController.reorder);
router.patch('/bulk-assign', requireRole('org_admin'), customerValidator.bulkAssign, validate, customerController.bulkAssign);
router.patch('/bulk-assign-vehicle', requireRole('org_admin'), customerValidator.bulkAssignVehicle, validate, customerController.bulkAssignVehicle);
router.patch('/bulk-status', requireRole('org_admin'), customerValidator.bulkStatus, validate, customerController.bulkStatus);
router.get('/:id', customerController.getDetail);
router.get('/:id/orders', customerController.listOrders);
router.post('/', customerValidator.createCustomer, validate, customerController.create);
router.patch('/:id', requireRole('org_admin'), customerValidator.updateCustomer, validate, customerController.update);
router.post('/:id/wallet-topup', requireRole('org_admin'), customerValidator.walletTopup, validate, customerController.walletTopup);
router.post('/:id/portal-link', requireRole('org_admin'), customerController.getPortalLink);

module.exports = router;
