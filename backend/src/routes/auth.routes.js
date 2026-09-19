const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const authValidator = require('../validators/auth.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');

const router = Router();

router.post('/login', authValidator.login, validate, authController.login);
router.get('/me', authenticate, authController.me);
router.patch('/me', authenticate, authController.updateMe);
router.post('/me/password', authenticate, authValidator.changePassword, validate, authController.changePassword);

module.exports = router;
