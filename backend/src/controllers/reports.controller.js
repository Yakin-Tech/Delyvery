const supabase = require('../config/supabaseClient');
const { requireOrgId } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { buildCsv, sendCsv } = require('../utils/csv');
const { computeTotalDue } = require('../utils/customerLedger');

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Every report accepts the same optional date_from/date_to (defaulting to a
// 90-day window) — one place to change the default instead of duplicating it
// eight times.
function dateRange(req, defaultDays = 90) {
  return {
    from: req.query.date_from || isoDaysAgo(defaultDays),
    to: req.query.date_to || todayISODate(),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---- time buckets --------------------------------------------------------
// The time-series reports (sales overview, collections) can be grouped by day, week
// (starting Monday) or month. A bucket is named by its first date, and every bucket in
// the range is listed — even the empty ones — so a chart has no gaps.
const GROUP_BY = ['day', 'week', 'month'];
const MAX_BUCKETS = { day: 800, week: 400, month: 120 };
const MAX_RANGE_DAYS = 3660;

function bucketStart(date, group) {
  if (group === 'month') return `${date.slice(0, 7)}-01`;
  if (group === 'week') {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return date;
}

// The bucket starts from `from` to `to`, oldest first. A range that would need more than
// MAX_BUCKETS drops its oldest buckets rather than its newest.
function bucketDates(from, to, group) {
  const starts = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  for (let i = 0; cursor <= end && i < MAX_RANGE_DAYS; i += 1) {
    const start = bucketStart(cursor.toISOString().slice(0, 10), group);
    if (starts[starts.length - 1] !== start) starts.push(start);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return starts.slice(-MAX_BUCKETS[group]);
}

function groupParam(req) {
  const value = req.query.group_by;
  if (value === undefined || value === '') return 'day';
  if (!GROUP_BY.includes(value)) throw ApiError.badRequest(`group_by must be one of: ${GROUP_BY.join(', ')}`);
  return value;
}

// ---- filters -------------------------------------------------------------
// Beyond the date range, reports can be narrowed by product, vehicle, staff member and
// payment status / mode. They are all optional and only ever narrow rows that are already
// scoped to the organization, so an id from another organization simply matches nothing.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_STATUSES = ['paid', 'partial', 'pending'];
const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other'];

function idParam(req, name) {
  const value = req.query[name];
  if (value === undefined || value === '') return null;
  if (!UUID_PATTERN.test(value)) throw ApiError.badRequest(`${name} must be a valid id`);
  return value;
}

function choiceParam(req, name, allowed) {
  const value = req.query[name];
  if (value === undefined || value === '') return null;
  if (!allowed.includes(value)) throw ApiError.badRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function reportFilters(req) {
  return {
    productId: idParam(req, 'product_id'),
    vehicleId: idParam(req, 'vehicle_id'),
    staffId: idParam(req, 'staff_id'),
    paymentStatus: choiceParam(req, 'payment_status', PAYMENT_STATUSES),
    paymentMode: choiceParam(req, 'payment_mode', PAYMENT_MODES),
  };
}

function filterDeliveries(query, filters) {
  let q = query;
  if (filters.productId) q = q.eq('product_id', filters.productId);
  if (filters.vehicleId) q = q.eq('vehicle_id', filters.vehicleId);
  if (filters.staffId) q = q.eq('staff_id', filters.staffId);
  if (filters.paymentStatus) q = q.eq('payment_status', filters.paymentStatus);
  if (filters.paymentMode) q = q.eq('payment_mode', filters.paymentMode);
  return q;
}

// Customers are "in" a vehicle or a staff member by assignment.
function filterCustomersByAssignment(query, filters) {
  let q = query;
  if (filters.vehicleId) q = q.eq('assigned_vehicle_id', filters.vehicleId);
  if (filters.staffId) q = q.eq('assigned_staff_id', filters.staffId);
  return q;
}

// 0a. Sales Overview — one row per day (or week, or month: group_by) of the range,
// buckets with nothing included so a chart has no gaps: what was delivered, what came
// in with it and what was left pending, plus how many of the deliveries were paid /
// part-paid / unpaid. Everything else on the page (totals, status split) is a sum of
// these. Narrowed by product, vehicle, staff and payment status.
async function computeSalesOverview(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req, 30);
  const group = groupParam(req);
  const filters = reportFilters(req);

  const deliveries = unwrap(await filterDeliveries(supabase.from('deliveries')
    .select('delivery_date, total_amount, amount_paid, payment_status')
    .eq('organization_id', orgId).gte('delivery_date', from).lte('delivery_date', to), filters));

  const byDate = new Map(bucketDates(from, to, group).map((date) => [date, {
    date, deliveries_count: 0, sales_value: 0, collected: 0, paid_count: 0, partial_count: 0, pending_count: 0,
  }]));
  for (const d of deliveries) {
    const row = byDate.get(bucketStart(d.delivery_date, group));
    if (!row) continue;
    row.deliveries_count += 1;
    row.sales_value += parseFloat(d.total_amount);
    row.collected += parseFloat(d.amount_paid);
    row[`${d.payment_status}_count`] += 1;
  }

  return [...byDate.values()].map((row) => ({
    ...row,
    sales_value: round2(row.sales_value),
    collected: round2(row.collected),
    pending: round2(row.sales_value - row.collected),
  }));
}

// 0b. Collections — money received against dues (the payments table), per day / week /
// month of the range, split by how it was paid. Wallet top-ups are money in too, so they
// count. Narrowed by payment mode, and by the vehicle it was collected on (vehicle
// orgs) or the staff member who recorded it.
async function computeCollections(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req, 30);
  const group = groupParam(req);
  const filters = reportFilters(req);

  let paymentsQuery = supabase.from('payments')
    .select('payment_date, amount, payment_mode')
    .eq('organization_id', orgId).gte('payment_date', from).lte('payment_date', to);
  if (filters.paymentMode) paymentsQuery = paymentsQuery.eq('payment_mode', filters.paymentMode);
  if (filters.vehicleId) paymentsQuery = paymentsQuery.eq('vehicle_id', filters.vehicleId);
  if (filters.staffId) paymentsQuery = paymentsQuery.eq('recorded_by', filters.staffId);
  const payments = unwrap(await paymentsQuery);

  const byDate = new Map(bucketDates(from, to, group).map((date) => [date, {
    date, payments_count: 0, amount: 0, cash: 0, upi: 0, bank_transfer: 0, card: 0, other: 0,
  }]));
  for (const p of payments) {
    const row = byDate.get(bucketStart(p.payment_date, group));
    if (!row) continue;
    const amount = parseFloat(p.amount);
    row.payments_count += 1;
    row.amount += amount;
    row[PAYMENT_MODES.includes(p.payment_mode) ? p.payment_mode : 'other'] += amount;
  }

  return [...byDate.values()].map((row) => ({
    ...row,
    amount: round2(row.amount),
    cash: round2(row.cash),
    upi: round2(row.upi),
    bank_transfer: round2(row.bank_transfer),
    card: round2(row.card),
    other: round2(row.other),
  }));
}

// 0c. Pending Aging — how long the money that is still owed has been owed: open
// (pending / part-paid) deliveries bucketed by age in days, plus the opening
// balances customers brought with them (which have no delivery to age from).
const AGING_BUCKETS = [
  { bucket: '0-7', max: 7 },
  { bucket: '8-15', max: 15 },
  { bucket: '16-30', max: 30 },
  { bucket: '31-60', max: 60 },
  { bucket: '61-90', max: 90 },
  { bucket: '90+', max: Infinity },
];
// Narrowed by product, vehicle / staff, and open status (pending or part-paid). Opening
// balances belong to a customer, not a delivery, so they are left out when a product or
// status is chosen, and follow the customer's assigned vehicle / staff otherwise.
async function computePendingAging(req) {
  const orgId = requireOrgId(req);
  const filters = reportFilters(req);
  const includeOpening = !filters.productId && !filters.paymentStatus;
  const openStatuses = filters.paymentStatus ? [filters.paymentStatus] : ['pending', 'partial'];

  const [openDeliveries, customers] = await Promise.all([
    filterDeliveries(
      supabase.from('deliveries').select('customer_id, delivery_date, total_amount, amount_paid')
        .eq('organization_id', orgId).in('payment_status', openStatuses),
      { ...filters, paymentStatus: null },
    ).then(unwrap),
    includeOpening
      ? filterCustomersByAssignment(supabase.from('customers').select('id, opening_balance').eq('organization_id', orgId).gt('opening_balance', 0), filters).then(unwrap)
      : Promise.resolve([]),
  ]);

  const rows = AGING_BUCKETS.map((b) => ({ bucket: b.bucket, deliveries_count: 0, customers: new Set(), amount: 0 }));
  for (const d of openDeliveries) {
    const outstanding = Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0);
    if (outstanding <= 0) continue;
    const age = Math.max(Math.floor((Date.now() - new Date(d.delivery_date).getTime()) / (24 * 60 * 60 * 1000)), 0);
    const index = AGING_BUCKETS.findIndex((b) => age <= b.max);
    rows[index].deliveries_count += 1;
    rows[index].customers.add(d.customer_id);
    rows[index].amount += outstanding;
  }

  const result = rows.map((r) => ({ bucket: r.bucket, deliveries_count: r.deliveries_count, customers_count: r.customers.size, amount: round2(r.amount) }));
  const opening = customers.reduce((sum, c) => sum + parseFloat(c.opening_balance), 0);
  if (opening > 0) result.push({ bucket: 'opening', deliveries_count: 0, customers_count: customers.length, amount: round2(opening) });
  return result;
}

// 1. Customer Inactivity — active customers with no delivery in the last N
// days (default 14). last_delivery_date is null for a customer who has never
// had one at all (flagged as inactive by definition).
async function computeCustomerInactivity(req) {
  const orgId = requireOrgId(req);
  const thresholdDays = parseInt(req.query.days, 10) || 14;
  const cutoff = isoDaysAgo(thresholdDays);
  const filters = reportFilters(req);

  const [customers, deliveries] = await Promise.all([
    filterCustomersByAssignment(supabase.from('customers').select('id, name, phone, assigned_staff:users(name)').eq('organization_id', orgId).eq('status', 'active'), filters).then(unwrap),
    supabase.from('deliveries').select('customer_id, delivery_date').eq('organization_id', orgId).order('delivery_date', { ascending: false }).then(unwrap),
  ]);

  const lastDeliveryByCustomer = new Map();
  for (const d of deliveries) {
    if (!lastDeliveryByCustomer.has(d.customer_id)) lastDeliveryByCustomer.set(d.customer_id, d.delivery_date);
  }

  return customers
    .map((c) => ({
      customer_id: c.id,
      customer_name: c.name,
      phone: c.phone || '',
      assigned_staff_name: c.assigned_staff?.name || '',
      last_delivery_date: lastDeliveryByCustomer.get(c.id) || null,
    }))
    .filter((r) => !r.last_delivery_date || r.last_delivery_date < cutoff)
    .sort((a, b) => (a.last_delivery_date || '').localeCompare(b.last_delivery_date || ''));
}

// 2. New Customer Acquisition — customers created per calendar month, over
// the requested range (default last 12 months).
async function computeNewCustomerAcquisition(req) {
  const orgId = requireOrgId(req);
  const months = parseInt(req.query.months, 10) || 12;
  const since = isoDaysAgo(months * 31);
  const filters = reportFilters(req);

  const customers = unwrap(await filterCustomersByAssignment(
    supabase.from('customers').select('created_at').eq('organization_id', orgId).gte('created_at', since),
    filters,
  ));

  const byMonth = new Map();
  for (const c of customers) {
    const month = c.created_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
  }

  return Array.from(byMonth.entries())
    .map(([month, count]) => ({ month, new_customers: count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// 3. Collection Efficiency — % of deliveries paid at the moment they were
// logged vs. left pending/settled later. Approximated as payment_status =
// 'paid' AND updated_at is still the same day as created_at (never touched
// by a later settlement) — there's no explicit "became fully paid at"
// timestamp in this schema, so this is a documented approximation, not exact.
async function computeCollectionEfficiency(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req);

  const deliveries = unwrap(await filterDeliveries(supabase.from('deliveries')
    .select('delivery_date, payment_status, created_at, updated_at, total_amount')
    .eq('organization_id', orgId).gte('delivery_date', from).lte('delivery_date', to), reportFilters(req)));

  let paidSameDay = 0;
  let paidLater = 0;
  let stillPending = 0;
  for (const d of deliveries) {
    if (d.payment_status === 'pending') {
      stillPending += 1;
    } else if (d.payment_status === 'paid' && d.created_at.slice(0, 10) === d.updated_at.slice(0, 10)) {
      paidSameDay += 1;
    } else {
      paidLater += 1;
    }
  }
  const total = deliveries.length;

  return [{
    total_deliveries: total,
    paid_same_day: paidSameDay,
    paid_later: paidLater,
    still_pending: stillPending,
    paid_same_day_pct: total > 0 ? Math.round((paidSameDay / total) * 1000) / 10 : 0,
  }];
}

// 4. Staff Productivity — deliveries/hour and collection rate per staff.
// "Hours worked" isn't tracked anywhere, so it's approximated per day as the
// span between a staff member's first and last delivery_time that day
// (floored at 15 minutes so one or two quick deliveries don't produce a
// misleadingly huge rate), then averaged across the days they worked in range.
async function computeStaffProductivity(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req);
  const MIN_SPAN_HOURS = 0.25;

  const [deliveries, staffList] = await Promise.all([
    filterDeliveries(supabase.from('deliveries').select('staff_id, delivery_date, delivery_time, total_amount, amount_paid')
      .eq('organization_id', orgId).gte('delivery_date', from).lte('delivery_date', to), reportFilters(req)).then(unwrap),
    supabase.from('users').select('id, name').eq('organization_id', orgId).eq('role', 'staff').then(unwrap),
  ]);

  const byStaffDay = new Map();
  for (const d of deliveries) {
    const key = `${d.staff_id}#${d.delivery_date}`;
    const entry = byStaffDay.get(key) || { staff_id: d.staff_id, times: [], value: 0, collected: 0, count: 0 };
    entry.times.push(new Date(d.delivery_time).getTime());
    entry.value += parseFloat(d.total_amount);
    entry.collected += parseFloat(d.amount_paid);
    entry.count += 1;
    byStaffDay.set(key, entry);
  }

  const dayRatesByStaff = new Map();
  for (const entry of byStaffDay.values()) {
    const spanHours = Math.max((Math.max(...entry.times) - Math.min(...entry.times)) / (60 * 60 * 1000), MIN_SPAN_HOURS);
    const list = dayRatesByStaff.get(entry.staff_id) || [];
    list.push({ rate: entry.count / spanHours, value: entry.value, collected: entry.collected });
    dayRatesByStaff.set(entry.staff_id, list);
  }

  const staffNameById = new Map(staffList.map((s) => [s.id, s.name]));
  const results = [];
  for (const [staffId, days] of dayRatesByStaff.entries()) {
    const avgRate = days.reduce((sum, d) => sum + d.rate, 0) / days.length;
    const totalValue = days.reduce((sum, d) => sum + d.value, 0);
    const totalCollected = days.reduce((sum, d) => sum + d.collected, 0);
    results.push({
      staff_id: staffId,
      staff_name: staffNameById.get(staffId) || '—',
      deliveries_per_hour: Math.round(avgRate * 100) / 100,
      avg_collection_rate_pct: totalValue > 0 ? Math.round((totalCollected / totalValue) * 1000) / 10 : 0,
      days_active: days.length,
    });
  }
  return results.sort((a, b) => b.deliveries_per_hour - a.deliveries_per_hour);
}

// 4b. Vehicle Performance — the vehicle_eod counterpart of Staff Productivity:
// what each vehicle delivered, collected and left pending over the range.
// Deliberately a straight rollup rather than deliveries-per-hour — an
// end-of-day batch is keyed in all at once, so delivery_time says when the note
// was typed in, not when the deliveries actually happened.
async function computeVehiclePerformance(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req);

  const deliveries = unwrap(await filterDeliveries(supabase.from('deliveries')
    .select('vehicle_id, delivery_date, total_amount, amount_paid, vehicle:vehicles(id, vehicle_number, driver_name)')
    .eq('organization_id', orgId)
    .not('vehicle_id', 'is', null)
    .gte('delivery_date', from)
    .lte('delivery_date', to), reportFilters(req)));

  const byVehicle = new Map();
  for (const d of deliveries) {
    const entry = byVehicle.get(d.vehicle_id) || {
      vehicle_id: d.vehicle_id,
      vehicle_number: d.vehicle?.vehicle_number || '—',
      driver_name: d.vehicle?.driver_name || null,
      total_deliveries: 0,
      total_value: 0,
      total_collected: 0,
      days: new Set(),
    };
    entry.total_deliveries += 1;
    entry.total_value += parseFloat(d.total_amount);
    entry.total_collected += parseFloat(d.amount_paid);
    entry.days.add(d.delivery_date);
    byVehicle.set(d.vehicle_id, entry);
  }

  return Array.from(byVehicle.values())
    .map((e) => ({
      vehicle_id: e.vehicle_id,
      vehicle_number: e.vehicle_number,
      driver_name: e.driver_name,
      total_deliveries: e.total_deliveries,
      total_value: Math.round(e.total_value * 100) / 100,
      total_collected: Math.round(e.total_collected * 100) / 100,
      total_pending: Math.round((e.total_value - e.total_collected) * 100) / 100,
      collection_rate_pct: e.total_value > 0 ? Math.round((e.total_collected / e.total_value) * 1000) / 10 : 0,
      days_active: e.days.size,
    }))
    .sort((a, b) => b.total_value - a.total_value);
}

// 5. Product-wise Sales — only meaningful for orgs using the multi-product
// catalog, but computed regardless (a single-product org just gets one row,
// or a "No product" row for deliveries logged without one selected).
async function computeProductSales(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req);

  const deliveries = unwrap(await filterDeliveries(supabase.from('deliveries')
    .select('product_id, quantity, total_amount, product:products(name)')
    .eq('organization_id', orgId).gte('delivery_date', from).lte('delivery_date', to), reportFilters(req)));

  const byProduct = new Map();
  for (const d of deliveries) {
    const key = d.product_id || 'none';
    const entry = byProduct.get(key) || { product_id: d.product_id, product_name: d.product?.name || 'No product', quantity: 0, sales_value: 0, deliveries_count: 0 };
    entry.quantity += parseFloat(d.quantity);
    entry.sales_value += parseFloat(d.total_amount);
    entry.deliveries_count += 1;
    byProduct.set(key, entry);
  }

  return Array.from(byProduct.values())
    .map((e) => ({ ...e, quantity: Math.round(e.quantity * 100) / 100, sales_value: Math.round(e.sales_value * 100) / 100 }))
    .sort((a, b) => b.sales_value - a.sales_value);
}

// 6. Zone-wise Performance — there is no real customer/geo zone (deliberately
// dropped from `customers`, see schema.sql). This groups by the delivering
// staff's own assigned_zone instead, transitively via assigned_staff_id — a
// real limitation, not a true customer-location breakdown.
async function computeZonePerformance(req) {
  const orgId = requireOrgId(req);

  const customers = unwrap(await supabase.from('customers')
    .select('id, opening_balance, credit_balance, assigned_staff:users(assigned_zone)')
    .eq('organization_id', orgId).eq('status', 'active'));
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length === 0) return [];

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

  const byZone = new Map();
  for (const c of customers) {
    const zone = c.assigned_staff?.assigned_zone || 'Unassigned';
    const totalDue = computeTotalDue({
      openingBalance: c.opening_balance,
      deliveryDue: deliveryDueByCustomer.get(c.id) || 0,
      creditNotesTotal: creditNotesByCustomer.get(c.id) || 0,
      creditBalance: c.credit_balance,
    });
    const entry = byZone.get(zone) || { zone, customer_count: 0, total_pending: 0 };
    entry.customer_count += 1;
    entry.total_pending += totalDue;
    byZone.set(zone, entry);
  }

  return Array.from(byZone.values())
    .map((e) => ({ ...e, total_pending: Math.round(e.total_pending * 100) / 100 }))
    .sort((a, b) => b.total_pending - a.total_pending);
}

// 7. Year-over-Year Comparison — month-by-month sales/deliveries for two
// requested years (default: this year vs. last), side by side.
async function computeYearOverYear(req) {
  const orgId = requireOrgId(req);
  const currentYear = new Date().getFullYear();
  const yearA = parseInt(req.query.year_a, 10) || currentYear - 1;
  const yearB = parseInt(req.query.year_b, 10) || currentYear;

  const deliveries = unwrap(await filterDeliveries(supabase.from('deliveries')
    .select('delivery_date, total_amount')
    .eq('organization_id', orgId)
    .gte('delivery_date', `${Math.min(yearA, yearB)}-01-01`)
    .lte('delivery_date', `${Math.max(yearA, yearB)}-12-31`), reportFilters(req)));

  const byYearMonth = new Map();
  for (const d of deliveries) {
    const [year, month] = d.delivery_date.split('-');
    const key = `${year}-${month}`;
    const entry = byYearMonth.get(key) || { sales_value: 0, deliveries_count: 0 };
    entry.sales_value += parseFloat(d.total_amount);
    entry.deliveries_count += 1;
    byYearMonth.set(key, entry);
  }

  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  return months.map((month) => {
    const a = byYearMonth.get(`${yearA}-${month}`) || { sales_value: 0, deliveries_count: 0 };
    const b = byYearMonth.get(`${yearB}-${month}`) || { sales_value: 0, deliveries_count: 0 };
    return {
      month,
      [`sales_${yearA}`]: Math.round(a.sales_value * 100) / 100,
      [`sales_${yearB}`]: Math.round(b.sales_value * 100) / 100,
      [`deliveries_${yearA}`]: a.deliveries_count,
      [`deliveries_${yearB}`]: b.deliveries_count,
    };
  });
}

// 8. Top Customers by Revenue — default last 12 months, top 20.
async function computeTopCustomers(req) {
  const orgId = requireOrgId(req);
  const { from, to } = dateRange(req, 365);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);

  const deliveries = unwrap(await filterDeliveries(supabase.from('deliveries')
    .select('customer_id, total_amount, customer:customers(name)')
    .eq('organization_id', orgId).gte('delivery_date', from).lte('delivery_date', to), reportFilters(req)));

  const byCustomer = new Map();
  for (const d of deliveries) {
    const entry = byCustomer.get(d.customer_id) || { customer_id: d.customer_id, customer_name: d.customer?.name || '—', revenue: 0, deliveries_count: 0 };
    entry.revenue += parseFloat(d.total_amount);
    entry.deliveries_count += 1;
    byCustomer.set(d.customer_id, entry);
  }

  return Array.from(byCustomer.values())
    .map((e) => ({ ...e, revenue: Math.round(e.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// One definition per report: how to compute it, and how to flatten it into
// CSV columns. Keeping this declarative (rather than 16 near-identical route
// handlers) is what lets getReport/exportReportCsv below stay generic.
const REPORTS = {
  'sales-overview': {
    compute: computeSalesOverview,
    csv: (rows) => ({
      headers: ['Date', 'Deliveries', 'Sales Value', 'Collected', 'Pending', 'Paid', 'Part Paid', 'Not Paid'],
      rows: rows.map((r) => [r.date, r.deliveries_count, r.sales_value, r.collected, r.pending, r.paid_count, r.partial_count, r.pending_count]),
    }),
  },
  collections: {
    compute: computeCollections,
    csv: (rows) => ({
      headers: ['Date', 'Payments', 'Amount', 'Cash', 'UPI', 'Bank Transfer', 'Card', 'Other'],
      rows: rows.map((r) => [r.date, r.payments_count, r.amount, r.cash, r.upi, r.bank_transfer, r.card, r.other]),
    }),
  },
  'pending-aging': {
    compute: computePendingAging,
    csv: (rows) => ({
      headers: ['Age (days)', 'Open Deliveries', 'Customers', 'Amount Pending'],
      rows: rows.map((r) => [r.bucket === 'opening' ? 'Opening balance' : r.bucket, r.deliveries_count, r.customers_count, r.amount]),
    }),
  },
  'customer-inactivity': {
    compute: computeCustomerInactivity,
    csv: (rows) => ({
      headers: ['Customer', 'Phone', 'Assigned Staff', 'Last Delivery Date'],
      rows: rows.map((r) => [r.customer_name, r.phone, r.assigned_staff_name, r.last_delivery_date || 'Never']),
    }),
  },
  'new-customer-acquisition': {
    compute: computeNewCustomerAcquisition,
    csv: (rows) => ({ headers: ['Month', 'New Customers'], rows: rows.map((r) => [r.month, r.new_customers]) }),
  },
  'collection-efficiency': {
    compute: computeCollectionEfficiency,
    csv: (rows) => ({
      headers: ['Total Deliveries', 'Paid Same Day', 'Paid Later', 'Still Pending', 'Paid Same Day %'],
      rows: rows.map((r) => [r.total_deliveries, r.paid_same_day, r.paid_later, r.still_pending, r.paid_same_day_pct]),
    }),
  },
  'staff-productivity': {
    compute: computeStaffProductivity,
    csv: (rows) => ({
      headers: ['Staff', 'Deliveries / Hour', 'Avg Collection Rate %', 'Days Active'],
      rows: rows.map((r) => [r.staff_name, r.deliveries_per_hour, r.avg_collection_rate_pct, r.days_active]),
    }),
  },
  'vehicle-performance': {
    compute: computeVehiclePerformance,
    csv: (rows) => ({
      headers: ['Vehicle', 'Driver', 'Deliveries', 'Total Value', 'Collected', 'Pending', 'Collection Rate %', 'Days Active'],
      rows: rows.map((r) => [r.vehicle_number, r.driver_name || '', r.total_deliveries, r.total_value, r.total_collected, r.total_pending, r.collection_rate_pct, r.days_active]),
    }),
  },
  'product-sales': {
    compute: computeProductSales,
    csv: (rows) => ({
      headers: ['Product', 'Quantity', 'Sales Value', 'Deliveries'],
      rows: rows.map((r) => [r.product_name, r.quantity, r.sales_value, r.deliveries_count]),
    }),
  },
  'zone-performance': {
    compute: computeZonePerformance,
    csv: (rows) => ({
      headers: ['Zone (staff)', 'Customers', 'Total Pending'],
      rows: rows.map((r) => [r.zone, r.customer_count, r.total_pending]),
    }),
  },
  'year-over-year': {
    compute: computeYearOverYear,
    csv: (rows) => ({
      headers: rows.length ? Object.keys(rows[0]) : ['Month'],
      rows: rows.map((r) => Object.values(r)),
    }),
  },
  'top-customers': {
    compute: computeTopCustomers,
    csv: (rows) => ({
      headers: ['Customer', 'Revenue', 'Deliveries'],
      rows: rows.map((r) => [r.customer_name, r.revenue, r.deliveries_count]),
    }),
  },
};

function resolveReport(name) {
  const def = REPORTS[name];
  if (!def) throw ApiError.notFound(`Unknown report: ${name}`);
  return def;
}

const getReport = asyncHandler(async (req, res) => {
  const def = resolveReport(req.params.name);
  res.json(await def.compute(req));
});

const exportReportCsv = asyncHandler(async (req, res) => {
  const def = resolveReport(req.params.name);
  const rows = await def.compute(req);
  const { headers, rows: csvRows } = def.csv(rows);
  sendCsv(res, `${req.params.name}.csv`, buildCsv(headers, csvRows));
});

const listReportNames = asyncHandler(async (req, res) => {
  res.json(Object.keys(REPORTS));
});

module.exports = { getReport, exportReportCsv, listReportNames };
