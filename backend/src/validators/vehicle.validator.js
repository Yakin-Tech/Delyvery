const { body } = require('express-validator');

const createVehicle = [
  body('vehicle_number').trim().notEmpty().withMessage('Vehicle number is required'),
  body('label').optional({ nullable: true }).trim(),
  body('driver_name').optional({ nullable: true }).trim(),
  body('driver_phone').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
];

const updateVehicle = [
  body('vehicle_number').optional().trim().notEmpty().withMessage('Vehicle number cannot be empty'),
  body('label').optional({ nullable: true }).trim(),
  body('driver_name').optional({ nullable: true }).trim(),
  body('driver_phone').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status'),
];

module.exports = { createVehicle, updateVehicle };
