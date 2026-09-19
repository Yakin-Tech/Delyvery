const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');

function deriveStatus(totalDeposit, returnedAmount) {
  if (returnedAmount <= 0) return 'held';
  if (returnedAmount >= totalDeposit) return 'fully_returned';
  return 'partially_returned';
}

const listForCustomer = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', req.params.customerId).maybeSingle());
  assertSameOrg(req, customer);

  const deposits = unwrap(await supabase
    .from('customer_deposits')
    .select('*')
    .eq('customer_id', req.params.customerId)
    .order('deposit_date', { ascending: false }));

  res.json(deposits);
});

const create = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', req.body.customer_id).maybeSingle());
  assertSameOrg(req, customer);

  const { item_name, quantity_deposited, deposit_amount_per_item, deposit_date, notes } = req.body;
  const quantity = quantity_deposited || 1;
  const totalDeposit = Math.round(quantity * deposit_amount_per_item * 100) / 100;

  const deposit = unwrap(await supabase.from('customer_deposits').insert({
    organization_id: req.user.organizationId,
    customer_id: req.body.customer_id,
    item_name,
    quantity_deposited: quantity,
    deposit_amount_per_item,
    total_deposit: totalDeposit,
    deposit_date: deposit_date || undefined,
    notes: notes || null,
    created_by: req.user.id,
  }).select('*').single());

  res.status(201).json(deposit);
});

// Records a partial or full return of a held deposit (e.g. the customer
// handed back the empty cylinder/can). Cumulative — each call adds to
// returned_amount rather than replacing it, so partial returns over time
// (return 2 of 3 cans today, the last one next month) compose correctly.
const recordReturn = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('customer_deposits').select('*').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);

  const { amount } = req.body;
  const newReturnedAmount = Math.min(parseFloat(existing.returned_amount) + parseFloat(amount), parseFloat(existing.total_deposit));

  const deposit = unwrap(await supabase.from('customer_deposits').update({
    returned_amount: newReturnedAmount,
    status: deriveStatus(parseFloat(existing.total_deposit), newReturnedAmount),
  }).eq('id', req.params.id).select('*').single());

  res.json(deposit);
});

module.exports = { listForCustomer, create, recordReturn };
