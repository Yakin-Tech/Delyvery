const { Router } = require('express');
const trashController = require('../controllers/trash.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.use(authenticate, requireRole('org_admin'));

router.get('/', trashController.list);
router.post('/:type/:id/restore', trashController.restore);
router.delete('/:type/:id', trashController.permanentDelete);
router.post('/:type/:id/anonymize', trashController.anonymize);
router.post('/:type/:id/force-delete', trashController.forceDelete);

module.exports = router;
