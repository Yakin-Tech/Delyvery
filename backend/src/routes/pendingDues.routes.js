const { Router } = require('express');
const pendingDuesController = require('../controllers/pendingDues.controller');
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const staffOnlyInVehicleOrgs = require('../middleware/staffOnlyInVehicleOrgs');

const router = Router();

router.use(authenticate, requireRole('org_admin', 'staff'));

// Route-staff's own "My Pending" list (their assigned / visible customers).
router.get('/mine', requireRole('staff'), pendingDuesController.listForStaff);

// The working lists — org admin always, office staff only in vehicle_eod orgs
// (staffOnlyInVehicleOrgs turns staff in any other org away).
router.get('/', staffOnlyInVehicleOrgs, pendingDuesController.listForOrg);
router.get('/vehicle-summary', staffOnlyInVehicleOrgs, pendingDuesController.vehicleSummary);
router.get('/staff-summary', requireRole('org_admin'), pendingDuesController.staffSummary);
router.get('/deliveries', staffOnlyInVehicleOrgs, pendingDuesController.listDeliveries);
router.get('/customers/:id', staffOnlyInVehicleOrgs, pendingDuesController.customerDues);

router.get('/export.csv', requireRole('org_admin'), pendingDuesController.exportCsv);

module.exports = router;
