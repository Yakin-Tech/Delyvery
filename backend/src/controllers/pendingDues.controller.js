const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { parsePagination } = require('../utils/paginate');
const { unwrapPage } = unwrap;
const sanitizeSearchTerm = require('../utils/sanitizeSearchTerm');
const { computeTotalDue } = require('../utils/customerLedger');
const { buildCsv, sendCsv } = require('../utils/csv');

function daysAgo(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

// Shared by the org-wide Pending Dues view and staff's "My Pending Collections".
// customerFilters scopes which customers are considered; a customer's due is
// their opening balance (pre-Delyver debt) plus open (pending/partial)
// deliveries, minus any credit notes issued to them and any credit balance
// they're carrying — see computeTotalDue.
async function computePendingDues({ organizationId, customerFilters = {}, search, minAgeDays, sort }) {
  let customerQuery = supabase.from('customers').select('*, assigned_staff:users(id, name), assigned_vehicle:vehicles(id, vehicle_number, driver_name)').eq('organization_id', organizationId);
  for (const [field, value] of Object.entries(customerFilters)) {
    customerQuery = customerQuery.eq(field, value);
  }
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term) customerQuery = customerQuery.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  const customers = unwrap(await customerQuery);
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length === 0) return [];

  const openDeliveries = unwrap(await supabase
    .from('deliveries')
    .select('customer_id, delivery_date, total_amount, amount_paid')
    .eq('organization_id', organizationId)
    .in('customer_id', customerIds)
    .in('payment_status', ['pending', 'partial'])
    .order('delivery_date', { ascending: true }));

  const lastPayments = unwrap(await supabase
    .from('payments')
    .select('customer_id, payment_date')
    .eq('organization_id', organizationId)
    .in('customer_id', customerIds)
    .order('payment_date', { ascending: false }));

  const creditNotes = unwrap(await supabase
    .from('credit_notes')
    .select('customer_id, amount')
    .eq('organization_id', organizationId)
    .in('customer_id', customerIds)
    .is('voided_at', null));

  const duesByCustomer = new Map();
  for (const delivery of openDeliveries) {
    const entry = duesByCustomer.get(delivery.customer_id) || { totalDue: 0, oldestUnpaidDate: null };
    entry.totalDue += Math.max(parseFloat(delivery.total_amount) - parseFloat(delivery.amount_paid), 0);
    if (!entry.oldestUnpaidDate || delivery.delivery_date < entry.oldestUnpaidDate) {
      entry.oldestUnpaidDate = delivery.delivery_date;
    }
    duesByCustomer.set(delivery.customer_id, entry);
  }

  const lastPaymentByCustomer = new Map();
  for (const payment of lastPayments) {
    if (!lastPaymentByCustomer.has(payment.customer_id)) {
      lastPaymentByCustomer.set(payment.customer_id, payment.payment_date);
    }
  }

  const creditNotesByCustomer = new Map();
  for (const note of creditNotes) {
    creditNotesByCustomer.set(note.customer_id, (creditNotesByCustomer.get(note.customer_id) || 0) + parseFloat(note.amount));
  }

  let results = customers
    .map((customer) => {
      const dues = duesByCustomer.get(customer.id) || { totalDue: 0, oldestUnpaidDate: null };
      const totalDue = computeTotalDue({
        openingBalance: customer.opening_balance,
        deliveryDue: dues.totalDue,
        creditNotesTotal: creditNotesByCustomer.get(customer.id) || 0,
        creditBalance: customer.credit_balance,
      });
      if (totalDue <= 0) return null;
      // A customer whose only debt is their opening balance has no delivery
      // to anchor "how long has this been pending" on — fall back to when
      // they were entered into Delyver.
      const oldestUnpaidDate = dues.oldestUnpaidDate || (parseFloat(customer.opening_balance) > 0 ? customer.created_at.slice(0, 10) : null);
      return {
        customer,
        total_due: totalDue,
        oldest_unpaid_date: oldestUnpaidDate,
        days_pending: oldestUnpaidDate ? daysAgo(oldestUnpaidDate) : 0,
        last_payment_date: lastPaymentByCustomer.get(customer.id) || null,
      };
    })
    .filter(Boolean);

  if (minAgeDays) {
    results = results.filter((r) => r.days_pending >= minAgeDays);
  }

  if (sort === 'oldest') {
    results.sort((a, b) => new Date(a.oldest_unpaid_date) - new Date(b.oldest_unpaid_date));
  } else {
    results.sort((a, b) => b.total_due - a.total_due);
  }

  return results;
}

const listForOrg = asyncHandler(async (req, res) => {
  const { staff_id, vehicle_id, search, min_age_days, sort } = req.query;
  const customerFilters = {};
  if (staff_id) customerFilters.assigned_staff_id = staff_id;
  if (vehicle_id) customerFilters.assigned_vehicle_id = vehicle_id;

  const results = await computePendingDues({
    organizationId: req.user.organizationId,
    customerFilters,
    search,
    minAgeDays: min_age_days ? parseInt(min_age_days, 10) : undefined,
    sort,
  });

  // computePendingDues is a JS-side aggregation, not a raw table query, so
  // pagination is applied by slicing the already-computed, already-sorted list.
  const pg = parsePagination(req.query);
  const page = results.slice(pg.from, pg.to + 1);
  const totals = results.reduce((sum, r) => sum + r.total_due, 0);

  res.json(pg.buildResult(page, results.length, { totals: { total_due: Math.round(totals * 100) / 100 } }));
});

const listForStaff = asyncHandler(async (req, res) => {
  // vehicle_eod customers belong to a vehicle, not to the staff member keying
  // in the day's notes, so there's no per-staff subset to narrow to there.
  const seesEveryone = req.organization.staff_sees_all_customers || req.organization.delivery_model === 'vehicle_eod';
  const customerFilters = seesEveryone ? {} : { assigned_staff_id: req.user.id };

  const results = await computePendingDues({
    organizationId: req.user.organizationId,
    customerFilters,
    sort: 'oldest',
  });

  res.json(results);
});

// Vehicle-wise pending, the vehicle_eod org's headline number. Two figures per
// vehicle because they answer different questions:
//   pending_from_deliveries — what the vehicle has delivered but not yet had
//     paid for (outstanding on deliveries.vehicle_id = this vehicle). This is
//     the driver-side "amount pending" from the day-notes, and shrinks as
//     later payments settle those deliveries.
//   assigned_customer_due — the full ledger balance (opening balance, credit
//     notes and credit included, see computeTotalDue) of the customers assigned
//     to this vehicle, i.e. what its regular customers owe overall.
// Anything with no vehicle (deliveries from before the org switched models,
// customers not yet assigned) lands in a single row with vehicle_id null so
// the column totals still reconcile with the org-wide Pending Dues.
const vehicleSummary = asyncHandler(async (req, res) => {
  const organizationId = req.user.organizationId;

  const [openDeliveries, customerDues] = await Promise.all([
    supabase.from('deliveries')
      .select('vehicle_id, delivery_date, total_amount, amount_paid, vehicle:vehicles(id, vehicle_number, driver_name)')
      .eq('organization_id', organizationId)
      .in('payment_status', ['pending', 'partial'])
      .then(unwrap),
    computePendingDues({ organizationId }),
  ]);

  const rowsByVehicle = new Map();
  const rowFor = (vehicle) => {
    const key = vehicle ? vehicle.id : 'none';
    if (!rowsByVehicle.has(key)) {
      rowsByVehicle.set(key, {
        vehicle_id: vehicle ? vehicle.id : null,
        vehicle_number: vehicle ? vehicle.vehicle_number : null,
        driver_name: vehicle ? vehicle.driver_name : null,
        open_deliveries_count: 0,
        pending_from_deliveries: 0,
        oldest_unpaid_date: null,
        assigned_customer_count: 0,
        assigned_customer_due: 0,
      });
    }
    return rowsByVehicle.get(key);
  };

  for (const d of openDeliveries) {
    const outstanding = Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0);
    if (outstanding <= 0) continue;
    const row = rowFor(d.vehicle);
    row.open_deliveries_count += 1;
    row.pending_from_deliveries += outstanding;
    if (!row.oldest_unpaid_date || d.delivery_date < row.oldest_unpaid_date) row.oldest_unpaid_date = d.delivery_date;
  }

  for (const r of customerDues) {
    const row = rowFor(r.customer.assigned_vehicle);
    row.assigned_customer_count += 1;
    row.assigned_customer_due += r.total_due;
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const rows = [...rowsByVehicle.values()]
    .map((row) => ({
      ...row,
      pending_from_deliveries: round2(row.pending_from_deliveries),
      assigned_customer_due: round2(row.assigned_customer_due),
      days_pending: row.oldest_unpaid_date ? daysAgo(row.oldest_unpaid_date) : 0,
    }))
    .sort((a, b) => b.pending_from_deliveries - a.pending_from_deliveries || b.assigned_customer_due - a.assigned_customer_due);

  res.json({
    rows,
    totals: {
      pending_from_deliveries: round2(rows.reduce((sum, r) => sum + r.pending_from_deliveries, 0)),
      assigned_customer_due: round2(rows.reduce((sum, r) => sum + r.assigned_customer_due, 0)),
    },
  });
});

// Staff-wise pending, the route_staff org's counterpart of vehicleSummary:
//   pending_from_deliveries — outstanding on the deliveries this staff member logged
//   assigned_customer_due   — the full ledger balance of the customers assigned to them
// Deliveries logged by someone no longer on the list, and customers not assigned to
// anyone, share one row with staff_id null so the totals still reconcile with the
// org-wide Pending Dues.
const staffSummary = asyncHandler(async (req, res) => {
  const organizationId = req.user.organizationId;

  const [openDeliveries, customerDues] = await Promise.all([
    supabase.from('deliveries')
      .select('staff_id, delivery_date, total_amount, amount_paid, staff:users(id, name)')
      .eq('organization_id', organizationId)
      .in('payment_status', ['pending', 'partial'])
      .then(unwrap),
    computePendingDues({ organizationId }),
  ]);

  const rowsByStaff = new Map();
  const rowFor = (staff) => {
    const key = staff ? staff.id : 'none';
    if (!rowsByStaff.has(key)) {
      rowsByStaff.set(key, {
        staff_id: staff ? staff.id : null,
        staff_name: staff ? staff.name : null,
        open_deliveries_count: 0,
        pending_from_deliveries: 0,
        oldest_unpaid_date: null,
        assigned_customer_count: 0,
        assigned_customer_due: 0,
      });
    }
    return rowsByStaff.get(key);
  };

  for (const d of openDeliveries) {
    const outstanding = Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0);
    if (outstanding <= 0) continue;
    const row = rowFor(d.staff);
    row.open_deliveries_count += 1;
    row.pending_from_deliveries += outstanding;
    if (!row.oldest_unpaid_date || d.delivery_date < row.oldest_unpaid_date) row.oldest_unpaid_date = d.delivery_date;
  }

  for (const r of customerDues) {
    const row = rowFor(r.customer.assigned_staff);
    row.assigned_customer_count += 1;
    row.assigned_customer_due += r.total_due;
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const rows = [...rowsByStaff.values()]
    .map((row) => ({
      ...row,
      pending_from_deliveries: round2(row.pending_from_deliveries),
      assigned_customer_due: round2(row.assigned_customer_due),
      days_pending: row.oldest_unpaid_date ? daysAgo(row.oldest_unpaid_date) : 0,
    }))
    .sort((a, b) => b.pending_from_deliveries - a.pending_from_deliveries || b.assigned_customer_due - a.assigned_customer_due);

  res.json({
    rows,
    totals: {
      pending_from_deliveries: round2(rows.reduce((sum, r) => sum + r.pending_from_deliveries, 0)),
      assigned_customer_due: round2(rows.reduce((sum, r) => sum + r.assigned_customer_due, 0)),
    },
  });
});

// Delivery-wise pending: every open (pending / part-paid) delivery on its own
// row with what is still owed on it, oldest first — the list an office person
// works through when chasing money. Shares its filters with the customer-wise
// view (vehicle, search, minimum age). Money that is owed but not tied to a
// delivery (a customer's opening balance) doesn't appear here; the customer-wise
// list and the customer's dues breakdown carry it.
const listDeliveries = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req);
  const { vehicle_id, staff_id, customer_id, search, min_age_days } = req.query;
  const pg = parsePagination(req.query);

  let customerIds = null;
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term) {
      const matches = unwrap(await supabase.from('customers')
        .select('id')
        .eq('organization_id', orgId)
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%`));
      customerIds = matches.map((c) => c.id);
    }
  }
  const emptyTotals = { total_pending: 0, deliveries_count: 0 };
  if (customerIds !== null && customerIds.length === 0) return res.json(pg.buildResult([], 0, { totals: emptyTotals }));

  const cutoff = min_age_days
    ? new Date(Date.now() - parseInt(min_age_days, 10) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;

  const applyFilters = (query) => {
    let q = query.eq('organization_id', orgId).in('payment_status', ['pending', 'partial']);
    if (vehicle_id) q = q.eq('vehicle_id', vehicle_id);
    // Only the org admin can narrow to one staff member (the route_staff model's
    // counterpart of the vehicle filter); office staff see every open delivery.
    if (staff_id && req.user.role === 'org_admin') q = q.eq('staff_id', staff_id);
    if (customer_id) q = q.eq('customer_id', customer_id);
    if (customerIds) q = q.in('customer_id', customerIds);
    if (cutoff) q = q.lte('delivery_date', cutoff);
    return q;
  };

  const { data, count } = unwrapPage(await applyFilters(supabase.from('deliveries')
    .select('id, delivery_date, quantity, total_amount, amount_paid, payment_status, customer:customers(id, name, phone), staff:users(id, name), vehicle:vehicles(id, vehicle_number, driver_name), product:products(id, name, unit_of_measure)', { count: 'exact' }))
    .order('delivery_date', { ascending: true })
    .order('delivery_time', { ascending: true })
    .range(pg.from, pg.to));

  const rows = data.map((d) => ({
    ...d,
    pending_amount: Math.round(Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0) * 100) / 100,
    days_pending: daysAgo(d.delivery_date),
  }));

  const forTotals = unwrap(await applyFilters(supabase.from('deliveries').select('total_amount, amount_paid')));
  const totalPending = forTotals.reduce((sum, d) => sum + Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0), 0);

  res.json(pg.buildResult(rows, count, { totals: { total_pending: Math.round(totalPending * 100) / 100, deliveries_count: count } }));
});

// One customer's dues, itemised: the total they owe and how it is made up, plus
// each open delivery with its own balance. Feeds the customer page and the
// record-payment form (which previews how a payment will be applied), so it uses
// the same computeTotalDue rule as every other place that shows a customer's due.
const customerDues = asyncHandler(async (req, res) => {
  const customer = unwrap(await supabase.from('customers')
    .select('id, organization_id, name, phone, address, status, opening_balance, credit_balance, assigned_vehicle:vehicles(id, vehicle_number, driver_name)')
    .eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, customer);

  const [openDeliveries, creditNotes] = await Promise.all([
    supabase.from('deliveries')
      .select('id, delivery_date, quantity, total_amount, amount_paid, payment_status, product:products(id, name, unit_of_measure), vehicle:vehicles(id, vehicle_number)')
      .eq('customer_id', customer.id)
      .in('payment_status', ['pending', 'partial'])
      .order('delivery_date', { ascending: true })
      .order('delivery_time', { ascending: true })
      .then(unwrap),
    supabase.from('credit_notes').select('amount').eq('customer_id', customer.id).is('voided_at', null).then(unwrap),
  ]);

  const pendingDeliveries = openDeliveries
    .map((d) => ({
      ...d,
      pending_amount: Math.round(Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0) * 100) / 100,
      days_pending: daysAgo(d.delivery_date),
    }))
    .filter((d) => d.pending_amount > 0);

  const deliveryDue = pendingDeliveries.reduce((sum, d) => sum + d.pending_amount, 0);
  const creditNotesTotal = creditNotes.reduce((sum, n) => sum + parseFloat(n.amount), 0);
  const round2 = (n) => Math.round(n * 100) / 100;

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      status: customer.status,
      assigned_vehicle: customer.assigned_vehicle,
    },
    total_due: computeTotalDue({
      openingBalance: customer.opening_balance,
      deliveryDue,
      creditNotesTotal,
      creditBalance: customer.credit_balance,
    }),
    breakdown: {
      opening_balance: round2(parseFloat(customer.opening_balance)),
      delivery_due: round2(deliveryDue),
      credit_notes_total: round2(creditNotesTotal),
      credit_balance: round2(parseFloat(customer.credit_balance)),
    },
    pending_deliveries: pendingDeliveries,
  });
});

const exportCsv = asyncHandler(async (req, res) => {
  const { staff_id, vehicle_id, search, min_age_days, sort } = req.query;
  const customerFilters = {};
  if (staff_id) customerFilters.assigned_staff_id = staff_id;
  if (vehicle_id) customerFilters.assigned_vehicle_id = vehicle_id;

  const results = await computePendingDues({
    organizationId: req.user.organizationId,
    customerFilters,
    search,
    minAgeDays: min_age_days ? parseInt(min_age_days, 10) : undefined,
    sort,
  });

  const vehicleOrg = req.organization.delivery_model === 'vehicle_eod';
  const headers = ['Customer', 'Phone', vehicleOrg ? 'Assigned Vehicle' : 'Assigned Staff', 'Total Due', 'Oldest Unpaid Date', 'Days Pending', 'Last Payment Date'];
  const rows = results.map((r) => [
    r.customer.name,
    r.customer.phone || '',
    vehicleOrg
      ? (r.customer.assigned_vehicle ? r.customer.assigned_vehicle.vehicle_number : '')
      : (r.customer.assigned_staff ? r.customer.assigned_staff.name : ''),
    r.total_due.toFixed(2),
    r.oldest_unpaid_date || '',
    r.days_pending,
    r.last_payment_date || '',
  ]);

  sendCsv(res, 'pending-dues.csv', buildCsv(headers, rows));
});

module.exports = { listForOrg, listForStaff, vehicleSummary, staffSummary, listDeliveries, customerDues, exportCsv, computePendingDues };
