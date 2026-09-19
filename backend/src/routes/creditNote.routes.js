const { Router } = require('express');
const creditNoteController = require('../controllers/creditNote.controller');
const creditNoteValidator = require('../validators/creditNote.validator');
const validate = require('../utils/validate');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/customer/:customerId', creditNoteController.listForCustomer);
router.post('/', creditNoteValidator.createCreditNote, validate, creditNoteController.create);
router.post('/:id/void', creditNoteController.voidNote);

module.exports = router;
