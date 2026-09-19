const { Router } = require('express');
const productController = require('../controllers/product.controller');
const productValidator = require('../validators/product.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin', 'staff'));

router.get('/', productController.list);
router.post('/', requireRole('org_admin'), productValidator.createProduct, validate, productController.create);
router.patch('/:id', requireRole('org_admin'), productValidator.updateProduct, validate, productController.update);
router.get('/:id/price-history', requireRole('org_admin'), productController.priceHistory);
router.post('/:id/apply-price-retroactively', requireRole('org_admin'), productValidator.applyPriceRetroactively, validate, productController.applyPriceRetroactively);

module.exports = router;
