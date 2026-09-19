const { Router } = require('express');
const deliveryController = require('../controllers/delivery.controller');
const deliveryValidator = require('../validators/delivery.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin', 'staff'));

router.get('/', deliveryController.list);
router.get('/places', deliveryController.recentPlaces);
router.post('/places/dismiss', deliveryValidator.dismissPlace, validate, deliveryController.dismissPlace);
router.get('/today-board', requireRole('staff'), deliveryController.todayBoard);
router.get('/my-summary', requireRole('staff'), deliveryController.mySummary);
router.post('/', deliveryValidator.createDelivery, validate, deliveryController.create);
router.post('/skip', requireRole('staff'), deliveryValidator.skipDelivery, validate, deliveryController.skip);
router.post('/sync-batch', requireRole('staff'), deliveryValidator.syncBatch, validate, deliveryController.syncBatch);
router.post('/vehicle-eod-batch', deliveryValidator.vehicleEodBatch, validate, deliveryController.vehicleEodBatch);
router.patch('/:id', requireRole('org_admin'), deliveryValidator.updateDelivery, validate, deliveryController.update);
router.delete('/:id', requireRole('org_admin'), deliveryController.remove);

module.exports = router;
