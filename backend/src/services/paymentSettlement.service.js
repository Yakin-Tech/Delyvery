const supabase = require('../config/supabaseClient');
const unwrap = require('../utils/unwrap');

// Applies a lump-sum payment to a customer's oldest pending/partial deliveries
// first (FIFO), then inserts the Payment row — all inside the `apply_payment_fifo`
// Postgres function (backend/supabase/schema.sql) so the whole thing is atomic.
async function applyPaymentFifo({ organizationId, customerId, amount, recordedBy, paymentMode, paymentDate, notes, vehicleId, clientRefId }) {
  const rows = unwrap(await supabase.rpc('apply_payment_fifo', {
    p_organization_id: organizationId,
    p_customer_id: customerId,
    p_amount: amount,
    p_recorded_by: recordedBy,
    p_payment_mode: paymentMode || 'cash',
    p_payment_date: paymentDate || null,
    p_notes: notes || null,
    p_vehicle_id: vehicleId || null,
    p_client_ref_id: clientRefId || null,
  }));

  const result = rows[0];
  return { paymentId: result.payment_id, unappliedAmount: parseFloat(result.unapplied_amount) };
}

// Same idea, but the caller (Org Admin) picks exactly which deliveries the
// payment covers instead of always settling oldest-first — used when the
// org's payment_allocation_mode is 'manual'. See apply_payment_manual in
// schema.sql.
async function applyPaymentManual({ organizationId, customerId, amount, recordedBy, paymentMode, paymentDate, notes, allocations, vehicleId, clientRefId }) {
  const rows = unwrap(await supabase.rpc('apply_payment_manual', {
    p_organization_id: organizationId,
    p_customer_id: customerId,
    p_amount: amount,
    p_recorded_by: recordedBy,
    p_payment_mode: paymentMode || 'cash',
    p_payment_date: paymentDate || null,
    p_notes: notes || null,
    p_allocations: allocations || [],
    p_vehicle_id: vehicleId || null,
    p_client_ref_id: clientRefId || null,
  }));

  const result = rows[0];
  return { paymentId: result.payment_id, unappliedAmount: parseFloat(result.unapplied_amount) };
}

module.exports = { applyPaymentFifo, applyPaymentManual };
