const { Router } = require('express');
const depositController = require('../controllers/customerDeposit.controller');
const depositValidator = require('../validators/customerDeposit.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin', 'staff'));

router.get('/customer/:customerId', depositController.listForCustomer);
router.post('/', requireRole('org_admin'), depositValidator.createDeposit, validate, depositController.create);
router.post('/:id/return', requireRole('org_admin'), depositValidator.recordReturn, validate, depositController.recordReturn);

module.exports = router;
