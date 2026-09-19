const { body } = require('express-validator');

const createMovement = [
  body('product_id').isUUID().withMessage('Invalid product_id'),
  body('movement_type').isIn(['out', 'return', 'received_from_supplier']).withMessage('Invalid movement_type'),
  body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('movement_date').optional({ nullable: true }).isISO8601().withMessage('Invalid movement date'),
  body('reference_delivery_id').optional({ nullable: true }).isUUID().withMessage('Invalid reference_delivery_id'),
  body('notes').optional({ nullable: true }).trim(),
];

module.exports = { createMovement };
