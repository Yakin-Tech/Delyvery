const supabase = require('../config/supabaseClient');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { computeTotalDue } = require('../utils/customerLedger');

const PORTAL_DELIVERY_WINDOW_DAYS = 30;

// Public, read-only, no authentication at all (see routes/portal.routes.js
// and the customers.portal_token comment in schema.sql for the security
// posture). Looks up strictly by token — never by id — and returns ONLY this
// one customer's own data: no staff names, no other customers, nothing
// org-wide. Any change here should be re-checked against that boundary.
const getPortalData = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers')
    .select('id, name, opening_balance, credit_balance, preferred_language, organization:organizations(default_language)')
    .eq('portal_token', req.params.token)
    .maybeSingle());
  if (!customer) throw ApiError.notFound('This link is no longer valid.');

  const since = new Date(Date.now() - PORTAL_DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [deliveries, openDeliveries, creditNotes, lastPayment] = await Promise.all([
    supabase.from('deliveries').select('delivery_date, quantity, total_amount, amount_paid, payment_status, product:products(name)')
      .eq('customer_id', customer.id).gte('delivery_date', since).order('delivery_date', { ascending: false }).then(unwrap),
    supabase.from('deliveries').select('total_amount, amount_paid').eq('customer_id', customer.id).in('payment_status', ['pending', 'partial']).then(unwrap),
    supabase.from('credit_notes').select('amount').eq('customer_id', customer.id).is('voided_at', null).then(unwrap),
    supabase.from('payments').select('payment_date').eq('customer_id', customer.id).order('payment_date', { ascending: false }).limit(1).maybeSingle().then(unwrap),
  ]);

  const deliveryDue = openDeliveries.reduce((sum, d) => sum + Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0), 0);
  const creditNotesTotal = creditNotes.reduce((sum, n) => sum + parseFloat(n.amount), 0);
  const totalDue = computeTotalDue({
    openingBalance: customer.opening_balance,
    deliveryDue,
    creditNotesTotal,
    creditBalance: customer.credit_balance,
  });

  res.json({
    customer_name: customer.name,
    language: customer.preferred_language || customer.organization?.default_language || 'en',
    total_due: totalDue,
    last_payment_date: lastPayment?.payment_date || null,
    deliveries: deliveries.map((d) => ({
      delivery_date: d.delivery_date,
      product_name: d.product?.name || null,
      quantity: d.quantity,
      total_amount: d.total_amount,
      amount_paid: d.amount_paid,
      payment_status: d.payment_status,
    })),
  });
});

module.exports = { getPortalData };
