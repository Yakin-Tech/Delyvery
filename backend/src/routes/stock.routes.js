const { Router } = require('express');
const stockController = require('../controllers/stock.controller');
const stockValidator = require('../validators/stock.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/', stockController.summary);
router.get('/product/:productId', stockController.listForProduct);
router.post('/', stockValidator.createMovement, validate, stockController.create);

module.exports = router;
