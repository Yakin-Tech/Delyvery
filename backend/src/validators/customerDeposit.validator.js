const { body } = require('express-validator');

const createDeposit = [
  body('customer_id').isUUID().withMessage('Invalid customer_id'),
  body('item_name').trim().notEmpty().withMessage('Item name is required'),
  body('quantity_deposited').optional().isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('deposit_amount_per_item').isFloat({ min: 0 }).withMessage('Deposit amount must be a non-negative number'),
  body('deposit_date').optional({ nullable: true }).isISO8601().withMessage('Invalid deposit date'),
  body('notes').optional({ nullable: true }).trim(),
];

const recordReturn = [
  body('amount').isFloat({ gt: 0 }).withMessage('Return amount must be a positive number'),
];

module.exports = { createDeposit, recordReturn };
