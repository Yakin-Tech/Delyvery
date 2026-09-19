const { body } = require('express-validator');

const createProduct = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('unit_of_measure').trim().notEmpty().withMessage('Unit of measure is required'),
  body('default_price').optional().isFloat({ min: 0 }).withMessage('Default price must be a non-negative number'),
  body('reorder_level').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Reorder level must be a non-negative whole number'),
  body('default_quantity').optional({ nullable: true }).isFloat({ gt: 0 }).withMessage('Default quantity must be greater than 0'),
];

const updateProduct = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('unit_of_measure').optional().trim().notEmpty().withMessage('Unit of measure cannot be empty'),
  body('default_price').optional().isFloat({ min: 0 }).withMessage('Default price must be a non-negative number'),
  body('is_active').optional().isBoolean().withMessage('Must be true or false'),
  body('reorder_level').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Reorder level must be a non-negative whole number'),
  body('default_quantity').optional({ nullable: true }).isFloat({ gt: 0 }).withMessage('Default quantity must be greater than 0'),
];

const applyPriceRetroactively = [
  body('new_price').isFloat({ min: 0 }).withMessage('New price must be a non-negative number'),
  body('date_from').isISO8601().withMessage('Invalid date_from'),
  body('date_to').isISO8601().withMessage('Invalid date_to'),
];

module.exports = { createProduct, updateProduct, applyPriceRetroactively };
