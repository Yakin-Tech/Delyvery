const { Router } = require('express');
const portalController = require('../controllers/portal.controller');
const portalRateLimit = require('../middleware/portalRateLimit');

const router = Router();

// Deliberately NOT using the `authenticate` middleware — this is the one
// public, unauthenticated surface in the whole API. See portal.controller.js
// and the customers.portal_token comment in schema.sql for why that's safe
// here (unguessable token, strictly read-only, scoped to one customer).
router.get('/:token', portalRateLimit, portalController.getPortalData);

module.exports = router;
