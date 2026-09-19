const { body } = require('express-validator');

const createCreditNote = [
  body('customer_id').isUUID().withMessage('Invalid customer_id'),
  body('delivery_id').optional({ nullable: true }).isUUID().withMessage('Invalid delivery_id'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
  body('reason').optional({ nullable: true }).trim(),
];

module.exports = { createCreditNote };
