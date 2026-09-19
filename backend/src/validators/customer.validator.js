const { body } = require('express-validator');
const { VALID_LANGUAGES } = require('../utils/languages');

const createCustomer = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').optional({ nullable: true }).trim(),
  body('alternate_phone').optional({ nullable: true }).trim(),
  body('address').optional({ nullable: true }).trim(),
  body('default_quantity').optional().isFloat({ gt: 0 }).withMessage('Default quantity must be a positive number'),
  body('custom_price_per_unit').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
  body('assigned_staff_id').optional({ nullable: true }).isUUID().withMessage('Invalid staff id'),
  body('assigned_vehicle_id').optional({ nullable: true }).isUUID().withMessage('Invalid vehicle id'),
  body('notes').optional({ nullable: true }).trim(),
  body('opening_balance').optional().isFloat({ min: 0 }).withMessage('Opening balance must be a non-negative number'),
  body('route_sequence').optional({ nullable: true }).isInt().withMessage('Route sequence must be a whole number'),
  body('preferred_language').optional({ nullable: true }).isIn(VALID_LANGUAGES).withMessage(`preferred_language must be one of: ${VALID_LANGUAGES.join(', ')}`),
];

const updateCustomer = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('phone').optional({ nullable: true }).trim(),
  body('alternate_phone').optional({ nullable: true }).trim(),
  body('address').optional({ nullable: true }).trim(),
  body('default_quantity').optional().isFloat({ gt: 0 }).withMessage('Default quantity must be a positive number'),
  body('custom_price_per_unit').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
  body('assigned_staff_id').optional({ nullable: true }).isUUID().withMessage('Invalid staff id'),
  body('assigned_vehicle_id').optional({ nullable: true }).isUUID().withMessage('Invalid vehicle id'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status'),
  body('notes').optional({ nullable: true }).trim(),
  body('opening_balance').optional().isFloat({ min: 0 }).withMessage('Opening balance must be a non-negative number'),
  body('route_sequence').optional({ nullable: true }).isInt().withMessage('Route sequence must be a whole number'),
  body('preferred_language').optional({ nullable: true }).isIn(VALID_LANGUAGES).withMessage(`preferred_language must be one of: ${VALID_LANGUAGES.join(', ')}`),
];

const walletTopup = [
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
  body('payment_mode').optional().isIn(['cash', 'upi', 'bank_transfer', 'card', 'other']).withMessage('Invalid payment mode'),
  body('payment_date').optional({ nullable: true }).isISO8601().withMessage('Invalid payment date'),
  body('notes').optional({ nullable: true }).trim(),
];

const bulkAssign = [
  body('customer_ids').isArray({ min: 1 }).withMessage('customer_ids must be a non-empty array'),
  body('customer_ids.*').isUUID().withMessage('Invalid customer id'),
  body('assigned_staff_id').optional({ nullable: true }).isUUID().withMessage('Invalid staff id'),
];

const bulkAssignVehicle = [
  body('customer_ids').isArray({ min: 1 }).withMessage('customer_ids must be a non-empty array'),
  body('customer_ids.*').isUUID().withMessage('Invalid customer id'),
  body('assigned_vehicle_id').optional({ nullable: true }).isUUID().withMessage('Invalid vehicle id'),
];

const bulkStatus = [
  body('customer_ids').isArray({ min: 1 }).withMessage('customer_ids must be a non-empty array'),
  body('customer_ids.*').isUUID().withMessage('Invalid customer id'),
  body('status').isIn(['active', 'inactive']).withMessage('Invalid status'),
];

module.exports = { createCustomer, updateCustomer, bulkAssign, bulkAssignVehicle, bulkStatus, walletTopup };
