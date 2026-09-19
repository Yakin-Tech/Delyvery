const { body } = require('express-validator');

const updateOwnOrganization = [
  body('unit_of_measure').optional().trim().notEmpty().withMessage('Unit of measure cannot be empty'),
  body('default_price_per_unit').optional().isFloat({ min: 0 }).withMessage('Default price must be a non-negative number'),
  body('address').optional({ nullable: true }).trim(),
  body('phone_numbers').optional().isArray().withMessage('phone_numbers must be an array'),
  body('delivery_modes').optional().isArray().withMessage('delivery_modes must be an array'),
  body('logo_url').optional({ nullable: true }).trim(),
  body('staff_sees_all_customers').optional().isBoolean().withMessage('Must be true or false'),
  body('staff_can_add_customers').optional().isBoolean().withMessage('Must be true or false'),
  body('payment_allocation_mode').optional().isIn(['fifo', 'manual']).withMessage('Must be fifo or manual'),
  body('products_enabled').optional().isBoolean().withMessage('Must be true or false'),
  body('routes_enabled').optional().isBoolean().withMessage('Must be true or false'),
  body('stock_enabled').optional().isBoolean().withMessage('Must be true or false'),
];

const updateOnboarding = [
  body('step').optional().isInt({ min: 0 }).withMessage('step must be a non-negative integer'),
  body('completed').optional().isBoolean().withMessage('completed must be true or false'),
];

module.exports = { updateOwnOrganization, updateOnboarding };
