const supabase = require('../config/supabaseClient');
const { requireOrgId } = require('../middleware/scopeToOrg');
const { applyPaymentFifo, applyPaymentManual } = require('../services/paymentSettlement.service');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');

const PAYMENT_SELECT = '*, customer:customers(id, name, phone), recorded_by_user:users(id, name), vehicle:vehicles(id, vehicle_number, driver_name)';

// A payment can't be dated in the future. One day of slack, because the person
// typing it in may be a timezone ahead of the server's UTC "today".
function latestAllowedPaymentDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function findByClientRef(orgId, clientRefId) {
  return unwrap(await supabase.from('payments').select(PAYMENT_SELECT)
    .eq('organization_id', orgId).eq('client_ref_id', clientRefId).maybeSingle());
}

const create = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req);
  const { customer_id, amount, payment_mode, payment_date, notes, allocations, vehicle_id, client_ref_id } = req.body;

  // Money is being recorded, so a repeat of the same request (double-tap, or a
  // retry after a response that never arrived) must hand back the payment that's
  // already there rather than count it twice.
  if (client_ref_id) {
    const prior = await findByClientRef(orgId, client_ref_id);
    if (prior) return res.status(200).json({ payment: prior, unapplied_amount: null, already_recorded: true });
  }

  if (payment_date && String(payment_date).slice(0, 10) > latestAllowedPaymentDate()) {
    throw ApiError.badRequest('A payment cannot be dated in the future');
  }

  const customer = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', customer_id).maybeSingle());
  if (!customer || customer.organization_id !== orgId) {
    throw ApiError.badRequest('Customer not found in your organization');
  }

  if (vehicle_id) {
    if (req.organization.delivery_model !== 'vehicle_eod') {
      throw ApiError.badRequest('Vehicles are not used by this organization');
    }
    const vehicle = unwrap(await supabase.from('vehicles').select('id, organization_id').eq('id', vehicle_id).maybeSingle());
    if (!vehicle || vehicle.organization_id !== orgId) throw ApiError.badRequest('Vehicle not found in your organization');
  }

  const useManual = req.organization.payment_allocation_mode === 'manual' && Array.isArray(allocations) && allocations.length > 0;

  const settle = useManual ? applyPaymentManual : applyPaymentFifo;
  let settled;
  try {
    settled = await settle({
      organizationId: orgId,
      customerId: customer_id,
      amount,
      recordedBy: req.user.id,
      paymentMode: payment_mode,
      paymentDate: payment_date,
      notes,
      allocations,
      vehicleId: vehicle_id,
      clientRefId: client_ref_id,
    });
  } catch (err) {
    // Two identical requests racing each other: the loser trips the unique
    // index on client_ref_id (and its whole transaction rolls back). Answer it
    // with the winner's payment.
    if (client_ref_id && err.statusCode === 409) {
      const prior = await findByClientRef(orgId, client_ref_id);
      if (prior) return res.status(200).json({ payment: prior, unapplied_amount: null, already_recorded: true });
    }
    throw err;
  }

  const payment = unwrap(await supabase.from('payments').select(PAYMENT_SELECT).eq('id', settled.paymentId).single());

  res.status(201).json({ payment, unapplied_amount: settled.unappliedAmount });
});

module.exports = { create };
