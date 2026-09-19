const { Router } = require('express');
const authRoutes = require('./auth.routes');
const staffRoutes = require('./staff.routes');
const vehicleRoutes = require('./vehicle.routes');
const customerRoutes = require('./customer.routes');
const deliveryRoutes = require('./delivery.routes');
const paymentRoutes = require('./payment.routes');
const pendingDuesRoutes = require('./pendingDues.routes');
const organizationRoutes = require('./organization.routes');
const superAdminRoutes = require('./superAdmin.routes');
const productRoutes = require('./product.routes');
const customerDepositRoutes = require('./customerDeposit.routes');
const creditNoteRoutes = require('./creditNote.routes');
const stockRoutes = require('./stock.routes');
const dashboardRoutes = require('./dashboard.routes');
const reportsRoutes = require('./reports.routes');
const portalRoutes = require('./portal.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
router.use('/staff', staffRoutes);
router.use('/vehicles', vehicleRoutes);
router.use('/customers', customerRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/payments', paymentRoutes);
router.use('/pending-dues', pendingDuesRoutes);
router.use('/organization', organizationRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/products', productRoutes);
router.use('/customer-deposits', customerDepositRoutes);
router.use('/credit-notes', creditNoteRoutes);
router.use('/stock', stockRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportsRoutes);
// Public, unauthenticated — see portal.routes.js.
router.use('/portal', portalRoutes);

module.exports = router;
