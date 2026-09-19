const { body } = require('express-validator');

const createPayment = [
  body('customer_id').isUUID().withMessage('Valid customer_id is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
  body('payment_mode').optional().isIn(['cash', 'upi', 'bank_transfer', 'card', 'other']).withMessage('Invalid payment mode'),
  body('payment_date').optional({ nullable: true }).isISO8601().withMessage('Invalid payment date'),
  body('notes').optional({ nullable: true }).trim(),
  // vehicle_eod orgs: the vehicle whose driver collected the money (optional).
  body('vehicle_id').optional({ nullable: true }).isUUID().withMessage('Invalid vehicle_id'),
  body('client_ref_id').optional({ nullable: true }).isUUID().withMessage('Invalid client_ref_id'),
  // Only used when the org's payment_allocation_mode is 'manual' — which
  // specific deliveries this payment covers, instead of always settling
  // oldest-first. See apply_payment_manual in schema.sql.
  body('allocations').optional().isArray().withMessage('allocations must be an array'),
  body('allocations.*.delivery_id').if(body('allocations').exists()).isUUID().withMessage('Invalid delivery_id in allocations'),
  body('allocations.*.amount').if(body('allocations').exists()).isFloat({ gt: 0 }).withMessage('Each allocation amount must be a positive number'),
];

module.exports = { createPayment };
