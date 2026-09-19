const crypto = require('crypto');
const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { unwrapPage } = unwrap;
const { parsePagination } = require('../utils/paginate');

const sanitizeSearchTerm = require('../utils/sanitizeSearchTerm');
const { computeTotalDue } = require('../utils/customerLedger');
const { VALID_LANGUAGES } = require('../utils/languages');

const WALLET_PROJECTION_WINDOW_DAYS = 14;

// "Will this customer's wallet run out in ~3 days?" (spec: Part 3 low-balance
// alert) needs a spend rate, and there's no stored one — it's derived from
// how much they've actually been delivered in the last 14 days, same
// derive-don't-store approach as everything else in this schema (stock,
// pending dues, etc). Returns null when there's nothing to project from (no
// recent deliveries), rather than a misleading "0 days".
function computeWalletProjection(creditBalance, recentDeliveries) {
  if (recentDeliveries.length === 0) return null;
  const totalSpend = recentDeliveries.reduce((sum, d) => sum + parseFloat(d.total_amount), 0);
  const avgDailySpend = totalSpend / WALLET_PROJECTION_WINDOW_DAYS;
  if (avgDailySpend <= 0) return null;
  return {
    avg_daily_spend: Math.round(avgDailySpend * 100) / 100,
    days_remaining: Math.round((parseFloat(creditBalance) / avgDailySpend) * 10) / 10,
  };
}

// Attaches each customer's total_due (same formula as getDetail/pendingDues —
// see computeTotalDue) to a page of customer rows, for the Customers list's
// "Pending" column. Scoped to just this page's ids rather than the whole org,
// since the list is paginated and this only needs to answer "what does this
// row currently owe."
async function attachTotalDue(customers) {
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length === 0) return customers;

  const [openDeliveries, creditNotes] = await Promise.all([
    supabase.from('deliveries').select('customer_id, total_amount, amount_paid')
      .in('customer_id', customerIds).in('payment_status', ['pending', 'partial']).then(unwrap),
    supabase.from('credit_notes').select('customer_id, amount')
      .in('customer_id', customerIds).is('voided_at', null).then(unwrap),
  ]);

  const deliveryDueByCustomer = new Map();
  for (const d of openDeliveries) {
    const due = Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0);
    deliveryDueByCustomer.set(d.customer_id, (deliveryDueByCustomer.get(d.customer_id) || 0) + due);
  }
  const creditNotesByCustomer = new Map();
  for (const n of creditNotes) {
    creditNotesByCustomer.set(n.customer_id, (creditNotesByCustomer.get(n.customer_id) || 0) + parseFloat(n.amount));
  }

  return customers.map((c) => ({
    ...c,
    total_due: computeTotalDue({
      openingBalance: c.opening_balance,
      deliveryDue: deliveryDueByCustomer.get(c.id) || 0,
      creditNotesTotal: creditNotesByCustomer.get(c.id) || 0,
      creditBalance: c.credit_balance,
    }),
  }));
}

const CUSTOMER_SELECT = '*, assigned_staff:users(id, name), assigned_vehicle:vehicles(id, vehicle_number, driver_name)';

const isVehicleOrg = (req) => req.organization.delivery_model === 'vehicle_eod';

// Staff only see their own assigned customers unless the org has opted them into
// seeing everyone. Org admins always see everyone. In a vehicle_eod org
// customers belong to a vehicle, not a staff member, so there's no per-staff
// subset to restrict to — staff there always see everyone.
function staffLimitedToOwnCustomers(req) {
  return req.user.role === 'staff' && !isVehicleOrg(req) && !req.organization.staff_sees_all_customers;
}

function applyVisibility(query, req) {
  if (staffLimitedToOwnCustomers(req)) {
    return query.eq('assigned_staff_id', req.user.id);
  }
  return query;
}

async function assertVehicleInOrg(req, vehicleId) {
  const vehicle = unwrap(await supabase.from('vehicles').select('id, organization_id').eq('id', vehicleId).maybeSingle());
  if (!vehicle || vehicle.organization_id !== req.user.organizationId) {
    throw ApiError.badRequest('Invalid assigned_vehicle_id');
  }
}

const list = asyncHandler(async (req, res) => {
  const { search, assigned_staff_id, assigned_vehicle_id, status, due_status, with_due } = req.query;
  const pg = parsePagination(req.query);

  let query = supabase.from('customers').select(CUSTOMER_SELECT, { count: 'exact' }).eq('organization_id', requireOrgId(req));
  query = applyVisibility(query, req);

  if (status) query = query.eq('status', status);
  if (assigned_staff_id && req.user.role === 'org_admin') query = query.eq('assigned_staff_id', assigned_staff_id);
  // Office staff in a vehicle_eod org see every customer anyway, so they may filter by vehicle too.
  if (assigned_vehicle_id && (req.user.role === 'org_admin' || isVehicleOrg(req))) query = query.eq('assigned_vehicle_id', assigned_vehicle_id);
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  // due_status ("pending" = owes something, "clear" = owes nothing) can't be
  // filtered in the database query — total_due is derived from deliveries
  // and credit_notes, not a column on customers — so when it's requested
  // this loads every customer matching the other filters (not just one
  // page), computes total_due for all of them, filters by that, and
  // paginates the filtered list here instead. Same fetch-and-reduce-in-JS
  // shape pendingDues.controller.js already uses for the full ledger report;
  // this is the boolean has-dues/no-dues version for the Customers list.
  if (due_status === 'pending' || due_status === 'clear') {
    const all = unwrap(await query.order('name', { ascending: true }));
    const withDue = await attachTotalDue(all);
    const filtered = withDue.filter((c) => (due_status === 'pending' ? c.total_due > 0 : c.total_due === 0));
    const page = filtered.slice(pg.from, pg.to + 1);
    return res.json(pg.buildResult(page, filtered.length));
  }

  const { data, count } = unwrapPage(await query.order('name', { ascending: true }).range(pg.from, pg.to));
  // attachTotalDue costs two extra round-trips (deliveries + credit_notes) —
  // real for a full page of rows, and pure waste for a quick lookup that
  // never shows it (CustomerPicker's search-as-you-type, RouteReorderPage's
  // list). Only the Customers list's "Pending" column actually needs it, so
  // it opts in explicitly instead of everyone paying for it by default.
  const responseData = with_due ? await attachTotalDue(data) : data;
  res.json(pg.buildResult(responseData, count));
});

const getDetail = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select(CUSTOMER_SELECT).eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, customer);

  if (staffLimitedToOwnCustomers(req)) {
    if (customer.assigned_staff_id !== req.user.id) throw ApiError.notFound('Resource not found');
  }

  const deliveries = unwrap(await supabase
    .from('deliveries')
    .select('*, staff:users(id, name), product:products(id, name, unit_of_measure), vehicle:vehicles(id, vehicle_number)')
    .eq('customer_id', customer.id)
    .order('delivery_date', { ascending: false })
    .order('delivery_time', { ascending: false }));

  const payments = unwrap(await supabase
    .from('payments')
    .select('*, vehicle:vehicles(id, vehicle_number), recorded_by_user:users(id, name)')
    .eq('customer_id', customer.id)
    .order('payment_date', { ascending: false }));

  const creditNotes = unwrap(await supabase
    .from('credit_notes')
    .select('*, issued_by_user:users!issued_by(id, name)')
    .eq('customer_id', customer.id)
    .order('issued_at', { ascending: false }));

  const deposits = unwrap(await supabase
    .from('customer_deposits')
    .select('*')
    .eq('customer_id', customer.id)
    .order('deposit_date', { ascending: false }));

  const deliveryDue = deliveries.reduce((sum, d) => sum + Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0), 0);
  const creditNotesTotal = creditNotes.filter((n) => !n.voided_at).reduce((sum, n) => sum + parseFloat(n.amount), 0);
  const totalDue = computeTotalDue({
    openingBalance: customer.opening_balance,
    deliveryDue,
    creditNotesTotal,
    creditBalance: customer.credit_balance,
  });

  const windowStart = new Date(Date.now() - WALLET_PROJECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentDeliveries = deliveries.filter((d) => d.delivery_date >= windowStart);
  const walletProjection = computeWalletProjection(customer.credit_balance, recentDeliveries);

  res.json({ customer, deliveries, payments, credit_notes: creditNotes, deposits, total_due: totalDue, wallet_projection: walletProjection });
});

// Every order (delivery) one customer has ever had, newest first, paged, with
// the totals for whatever the filters select — the customer page's "Orders" list.
// Unlike GET /deliveries this isn't limited to the deliveries the calling staff
// member keyed in: if the customer is visible to them, so is their whole history.
const ORDER_SELECT = '*, staff:users(id, name), product:products(id, name, unit_of_measure), vehicle:vehicles(id, vehicle_number)';

const listOrders = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id, assigned_staff_id').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, customer);
  if (staffLimitedToOwnCustomers(req) && customer.assigned_staff_id !== req.user.id) {
    throw ApiError.notFound('Resource not found');
  }

  const { payment_status, date_from, date_to, product_id } = req.query;
  const pg = parsePagination(req.query);
  const filtered = (query) => {
    let q = query.eq('customer_id', customer.id);
    if (payment_status) q = q.eq('payment_status', payment_status);
    if (date_from) q = q.gte('delivery_date', date_from);
    if (date_to) q = q.lte('delivery_date', date_to);
    if (product_id) q = q.eq('product_id', product_id);
    return q;
  };

  const { data, count } = unwrapPage(await filtered(supabase.from('deliveries').select(ORDER_SELECT, { count: 'exact' }))
    .order('delivery_date', { ascending: false })
    .order('delivery_time', { ascending: false })
    .range(pg.from, pg.to));

  const forTotals = unwrap(await filtered(supabase.from('deliveries').select('total_amount, amount_paid')));
  const value = forTotals.reduce((sum, d) => sum + parseFloat(d.total_amount), 0);
  const collected = forTotals.reduce((sum, d) => sum + parseFloat(d.amount_paid), 0);
  const round = (n) => Math.round(n * 100) / 100;

  res.json(pg.buildResult(data, count, {
    totals: { orders_count: forTotals.length, total_value: round(value), total_collected: round(collected), total_pending: round(value - collected) },
  }));
});

const create = asyncHandler(async (req, res) => {
  if (req.user.role === 'staff' && !isVehicleOrg(req) && !req.organization.staff_can_add_customers) {
    throw ApiError.forbidden('Staff are not permitted to add customers for this organization');
  }

  const {
    name, phone, alternate_phone, address,
    default_quantity, custom_price_per_unit, assigned_staff_id, assigned_vehicle_id, notes,
    opening_balance, route_sequence, preferred_language,
  } = req.body;

  if (assigned_vehicle_id) await assertVehicleInOrg(req, assigned_vehicle_id);

  if (phone) {
    // .limit(1) instead of .maybeSingle() — see the matching comment in
    // delivery.controller.js's resolveCustomerId for why.
    const [existing] = unwrap(await supabase.from('customers')
      .select('id, name')
      .eq('organization_id', req.user.organizationId)
      .eq('phone', phone)
      .limit(1));
    if (existing) throw ApiError.conflict(`This phone number is already registered to customer "${existing.name}"`);
  }

  const customer = unwrap(await supabase.from('customers').insert({
    organization_id: req.user.organizationId,
    name,
    phone: phone || null,
    alternate_phone: alternate_phone || null,
    address: address || null,
    default_quantity: default_quantity || 1,
    custom_price_per_unit: custom_price_per_unit ?? null,
    assigned_staff_id: assigned_staff_id || (req.user.role === 'staff' && !isVehicleOrg(req) ? req.user.id : null),
    assigned_vehicle_id: assigned_vehicle_id || null,
    notes: notes || null,
    opening_balance: opening_balance || 0,
    route_sequence: route_sequence ?? null,
    preferred_language: preferred_language || null,
  }).select(CUSTOMER_SELECT).single());

  res.status(201).json(customer);
});

const update = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);

  const fields = [
    'name', 'phone', 'alternate_phone', 'address',
    'default_quantity', 'custom_price_per_unit', 'assigned_staff_id', 'assigned_vehicle_id', 'status', 'notes',
    'opening_balance', 'route_sequence', 'preferred_language',
  ];
  const patch = {};
  for (const field of fields) {
    if (req.body[field] !== undefined) patch[field] = req.body[field];
  }
  if (patch.assigned_vehicle_id) await assertVehicleInOrg(req, patch.assigned_vehicle_id);

  if (patch.phone) {
    const [conflict] = unwrap(await supabase.from('customers')
      .select('id, name')
      .eq('organization_id', req.user.organizationId)
      .eq('phone', patch.phone)
      .neq('id', req.params.id)
      .limit(1));
    if (conflict) throw ApiError.conflict(`This phone number is already registered to customer "${conflict.name}"`);
  }

  const customer = unwrap(await supabase.from('customers').update(patch).eq('id', req.params.id).select(CUSTOMER_SELECT).single());
  res.json(customer);
});

// Bulk-saves a new visiting order after a drag-to-reorder in Org Admin's
// customer management. Body: { customer_ids: [id, id, ...] } in the new
// order — each gets a route_sequence 10 apart (not 1 apart) so a future
// single-customer nudge can slot between two without renumbering everything.
const reorder = asyncHandler(async (req, res) => {
  const { customer_ids } = req.body;
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw ApiError.badRequest('customer_ids must be a non-empty array');
  }

  const rows = unwrap(await supabase.from('customers').select('id, organization_id').in('id', customer_ids));
  if (rows.length !== customer_ids.length || rows.some((r) => r.organization_id !== req.user.organizationId)) {
    throw ApiError.badRequest('One or more customers were not found in your organization');
  }

  await Promise.all(customer_ids.map(async (id, index) => {
    const result = await supabase.from('customers').update({ route_sequence: (index + 1) * 10 }).eq('id', id);
    unwrap(result);
  }));

  res.json({ updated: customer_ids.length });
});

// Shared shape-check for the two bulk actions below: every id must exist and
// belong to this org, same guard as reorder() above.
async function assertAllInOrg(req, customerIds) {
  const rows = unwrap(await supabase.from('customers').select('id, organization_id').in('id', customerIds));
  if (rows.length !== customerIds.length || rows.some((r) => r.organization_id !== req.user.organizationId)) {
    throw ApiError.badRequest('One or more customers were not found in your organization');
  }
}

// Reassigns a batch of customers to a different staff member (and/or zone) in
// one action — the bulk version of update()'s single assigned_staff_id/
// assigned_zone patch, for the customer list's multi-select toolbar.
const bulkAssign = asyncHandler(async (req, res) => {
  const { customer_ids, assigned_staff_id } = req.body;
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw ApiError.badRequest('customer_ids must be a non-empty array');
  }
  await assertAllInOrg(req, customer_ids);

  if (assigned_staff_id) {
    const staff = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', assigned_staff_id).maybeSingle());
    if (!staff || staff.organization_id !== req.user.organizationId || staff.role !== 'staff') {
      throw ApiError.badRequest('Invalid assigned_staff_id');
    }
  }

  unwrap(await supabase.from('customers').update({ assigned_staff_id: assigned_staff_id || null }).in('id', customer_ids).select('id'));
  res.json({ updated: customer_ids.length });
});

// Vehicle-model counterpart of bulkAssign above: moves a batch of customers
// onto a vehicle (or, with a null/absent assigned_vehicle_id, off any vehicle).
const bulkAssignVehicle = asyncHandler(async (req, res) => {
  const { customer_ids, assigned_vehicle_id } = req.body;
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw ApiError.badRequest('customer_ids must be a non-empty array');
  }
  await assertAllInOrg(req, customer_ids);
  if (assigned_vehicle_id) await assertVehicleInOrg(req, assigned_vehicle_id);

  unwrap(await supabase.from('customers').update({ assigned_vehicle_id: assigned_vehicle_id || null }).in('id', customer_ids).select('id'));
  res.json({ updated: customer_ids.length });
});

// Bulk activate/deactivate — e.g. an org admin pausing every seasonal
// customer at the end of a season in one action instead of one by one.
const bulkStatus = asyncHandler(async (req, res) => {
  const { customer_ids, status } = req.body;
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    throw ApiError.badRequest('customer_ids must be a non-empty array');
  }
  await assertAllInOrg(req, customer_ids);

  unwrap(await supabase.from('customers').update({ status }).in('id', customer_ids).select('id'));
  res.json({ updated: customer_ids.length });
});

// A customer proactively topping up their standing balance — see
// apply_wallet_topup in schema.sql for why this is a separate SQL function
// from apply_payment_fifo/apply_payment_manual rather than just calling one
// of those with a flag: it deliberately skips due-settlement so the whole
// amount becomes usable credit instead of first paying off older dues.
const walletTopup = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, customer);

  const { amount, payment_mode, payment_date, notes } = req.body;

  unwrap(await supabase.rpc('apply_wallet_topup', {
    p_organization_id: req.user.organizationId,
    p_customer_id: customer.id,
    p_amount: amount,
    p_recorded_by: req.user.id,
    p_payment_mode: payment_mode || 'cash',
    p_payment_date: payment_date || null,
    p_notes: notes || null,
  }));

  const updated = unwrap(await supabase.from('customers').select(CUSTOMER_SELECT).eq('id', customer.id).single());
  res.status(201).json(updated);
});

// Lazily issues a portal_token the first time an org admin asks for a
// shareable link — see the schema.sql comment on customers.portal_token for
// why this is generated on demand rather than for every customer up front.
// Idempotent: a customer who already has one just gets it back unchanged, so
// a previously shared link keeps working.
const getPortalLink = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id, portal_token').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, customer);

  let token = customer.portal_token;
  if (!token) {
    const updated = unwrap(await supabase.from('customers').update({ portal_token: crypto.randomUUID() }).eq('id', customer.id).select('portal_token').single());
    token = updated.portal_token;
  }

  res.json({ portal_token: token });
});

module.exports = { list, getDetail, listOrders, create, update, reorder, bulkAssign, bulkAssignVehicle, bulkStatus, walletTopup, getPortalLink };
