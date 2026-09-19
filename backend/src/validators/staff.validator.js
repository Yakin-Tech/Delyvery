const { body } = require('express-validator');

const createStaff = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('assigned_zone').optional({ nullable: true }).trim(),
  body('preferred_language').optional({ nullable: true }).trim(),
];

const updateStaff = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('assigned_zone').optional({ nullable: true }).trim(),
  body('preferred_language').optional({ nullable: true }).trim(),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status'),
];

const resetPassword = [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

module.exports = { createStaff, updateStaff, resetPassword };
