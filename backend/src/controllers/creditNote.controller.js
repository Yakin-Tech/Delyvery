const supabase = require('../config/supabaseClient');
const { assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');

// credit_notes has two FKs into users (issued_by, voided_by); PostgREST needs
// the column name to disambiguate which relationship this embed follows.
const CREDIT_NOTE_SELECT = '*, issued_by_user:users!issued_by(id, name)';

const listForCustomer = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', req.params.customerId).maybeSingle());
  assertSameOrg(req, customer);

  const notes = unwrap(await supabase
    .from('credit_notes')
    .select(CREDIT_NOTE_SELECT)
    .eq('customer_id', req.params.customerId)
    .order('issued_at', { ascending: false }));

  res.json(notes);
});

const create = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', req.body.customer_id).maybeSingle());
  assertSameOrg(req, customer);

  if (req.body.delivery_id) {
    const delivery = unwrap(await supabase.from('deliveries').select('id, organization_id, customer_id').eq('id', req.body.delivery_id).maybeSingle());
    if (!delivery || delivery.organization_id !== req.user.organizationId || delivery.customer_id !== req.body.customer_id) {
      throw ApiError.badRequest('That delivery does not belong to this customer');
    }
  }

  const note = unwrap(await supabase.from('credit_notes').insert({
    organization_id: req.user.organizationId,
    customer_id: req.body.customer_id,
    delivery_id: req.body.delivery_id || null,
    amount: req.body.amount,
    reason: req.body.reason || null,
    issued_by: req.user.id,
  }).select(CREDIT_NOTE_SELECT).single());

  res.status(201).json(note);
});

// Corrects a mistaken credit note without deleting the financial record —
// a voided note stops counting against the customer's pending balance but
// stays visible in their history.
const voidNote = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('credit_notes').select('*').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);
  if (existing.voided_at) throw ApiError.badRequest('This credit note is already voided');

  const note = unwrap(await supabase.from('credit_notes').update({
    voided_at: new Date().toISOString(),
    voided_by: req.user.id,
  }).eq('id', req.params.id).select(CREDIT_NOTE_SELECT).single());

  res.json(note);
});

module.exports = { listForCustomer, create, voidNote };
