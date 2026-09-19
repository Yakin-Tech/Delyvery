const { body } = require('express-validator');

const createDelivery = [
  body('customer_id').optional({ nullable: true }).isUUID().withMessage('Invalid customer_id'),
  body('new_customer').optional({ nullable: true }).isObject().withMessage('Invalid new_customer'),
  body('new_customer.name').if(body('new_customer').exists()).trim().notEmpty().withMessage('New customer name is required'),
  body('new_customer.phone').optional({ nullable: true }).trim(),
  body().custom((value) => {
    if (!value.customer_id && !(value.new_customer && value.new_customer.name)) {
      throw new Error('Either customer_id or new_customer.name is required');
    }
    return true;
  }),
  body('product_id').optional({ nullable: true }).isUUID().withMessage('Invalid product_id'),
  body('vehicle_id').optional({ nullable: true }).isUUID().withMessage('Invalid vehicle_id'),
  body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('unit_price').isFloat({ min: 0 }).withMessage('Unit price must be a non-negative number'),
  body('total_amount').optional().isFloat({ min: 0 }).withMessage('Total amount must be a non-negative number'),
  body('payment_status').isIn(['paid', 'partial', 'pending']).withMessage('Invalid payment status'),
  body('amount_paid').optional().isFloat({ min: 0 }).withMessage('Amount paid must be a non-negative number'),
  body('payment_mode').optional({ nullable: true }).isIn(['cash', 'upi', 'bank_transfer', 'card', 'other']).withMessage('Invalid payment mode'),
  body('delivery_date').optional({ nullable: true }).isISO8601().withMessage('Invalid delivery date'),
  body('place').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
];

const updateDelivery = [
  body('product_id').optional({ nullable: true }).isUUID().withMessage('Invalid product_id'),
  body('vehicle_id').optional({ nullable: true }).isUUID().withMessage('Invalid vehicle_id'),
  body('quantity').optional().isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('unit_price').optional().isFloat({ min: 0 }).withMessage('Unit price must be a non-negative number'),
  body('total_amount').optional().isFloat({ min: 0 }).withMessage('Total amount must be a non-negative number'),
  body('payment_status').optional().isIn(['paid', 'partial', 'pending']).withMessage('Invalid payment status'),
  body('amount_paid').optional().isFloat({ min: 0 }).withMessage('Amount paid must be a non-negative number'),
  body('payment_mode').optional({ nullable: true }).isIn(['cash', 'upi', 'bank_transfer', 'card', 'other']).withMessage('Invalid payment mode'),
  body('place').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
];

const skipDelivery = [
  body('customer_id').isUUID().withMessage('Invalid customer_id'),
  body('reason').trim().notEmpty().withMessage('A skip reason is required'),
  body('skip_date').optional({ nullable: true }).isISO8601().withMessage('Invalid skip date'),
];

// Deliberately light validation — items travel in bulk from the offline
// queue and a single malformed item shouldn't 400 the whole batch. Per-item
// shape checks (kind-specific required fields, resolving a bad customer_id,
// etc.) happen in delivery.controller.js's syncBatch, where a bad item is
// reported back as that item's own "error" result instead of failing the
// request.
const syncBatch = [
  body('items').isArray({ min: 1, max: 200 }).withMessage('items must be a non-empty array (max 200)'),
  body('items.*.kind').isIn(['delivery', 'skip']).withMessage('Each item needs kind: delivery or skip'),
  body('items.*.client_ref_id').optional({ nullable: true }).isUUID().withMessage('Invalid client_ref_id'),
];

const dismissPlace = [
  body('customer_id').isUUID().withMessage('Invalid customer_id'),
  body('place').trim().notEmpty().withMessage('place is required'),
];

// One vehicle's paper note for one day. Same light-validation reasoning as
// syncBatch above: per-row checks live in delivery.controller.js's
// vehicleEodBatch so a single bad row doesn't reject the whole day.
const vehicleEodBatch = [
  body('vehicle_id').isUUID().withMessage('Choose a vehicle'),
  body('entry_date').optional({ nullable: true }).isISO8601().withMessage('Invalid entry date'),
  body('items').isArray({ min: 1, max: 200 }).withMessage('Add at least one delivery (max 200)'),
  body('items.*.client_ref_id').optional({ nullable: true }).isUUID().withMessage('Invalid client_ref_id'),
];

module.exports = { createDelivery, updateDelivery, skipDelivery, syncBatch, dismissPlace, vehicleEodBatch };
