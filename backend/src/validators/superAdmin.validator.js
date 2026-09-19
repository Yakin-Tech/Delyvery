const { body } = require('express-validator');

const createOrganization = [
  body('name').trim().notEmpty().withMessage('Organization name is required'),
  body('business_type').trim().notEmpty().withMessage('Business type is required'),
  body('address').optional({ nullable: true }).trim(),
  body('phone_numbers').optional().isArray().withMessage('phone_numbers must be an array'),
  body('admin_name').trim().notEmpty().withMessage('Admin name is required'),
  body('admin_phone').trim().notEmpty().withMessage('Admin phone is required'),
  body('admin_password').isLength({ min: 6 }).withMessage('Admin password must be at least 6 characters'),
  body('delivery_model').optional().isIn(['route_staff', 'vehicle_eod']).withMessage('Invalid delivery model'),
];

const updateOrganization = [
  body('name').optional().trim().notEmpty().withMessage('Organization name cannot be empty'),
  body('business_type').optional().trim().notEmpty().withMessage('Business type cannot be empty'),
  body('address').optional({ nullable: true }).trim(),
  body('phone_numbers').optional().isArray().withMessage('phone_numbers must be an array'),
  body('status').optional().isIn(['trial', 'active', 'suspended', 'expired']).withMessage('Invalid status'),
  body('delivery_model').optional().isIn(['route_staff', 'vehicle_eod']).withMessage('Invalid delivery model'),
];

const createOrgAdmin = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const updateOrgAdminStatus = [
  body('status').isIn(['active', 'inactive']).withMessage('Invalid status'),
];

const resetOrgAdminPassword = [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const impersonate = [
  body('as_user_id').optional().isUUID().withMessage('Invalid user id'),
];

module.exports = { createOrganization, updateOrganization, createOrgAdmin, updateOrgAdminStatus, resetOrgAdminPassword, impersonate };
