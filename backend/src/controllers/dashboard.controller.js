const supabase = require('../config/supabaseClient');
const { requireOrgId } = require('../middleware/scopeToOrg');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { computePendingDues } = require('./pendingDues.controller');

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

const HIGH_OVERDUE_THRESHOLD = 1000;
const HIGH_OVERDUE_MIN_AGE_DAYS = 7;
const NOTIFICATION_WINDOW_DAYS = 7;
const MONTHLY_SUMMARY_WINDOW_DAYS = 5;

// Everything the Org Admin dashboard needs in one call: stats + charts for
// whatever date range the filter picks, plus a "today" slice that's always
// today regardless of that filter (so the two "period" and "today" stat rows
// never both collapse to the same thing when the filter itself is "Today").
const getDashboard = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req);
  const today = todayISODate();
  const periodFrom = req.query.date_from || today;
  const periodTo = req.query.date_to || today;

  const periodDeliveries = unwrap(await supabase
    .from('deliveries')
    .select('delivery_date, total_amount, amount_paid, payment_status')
    .eq('organization_id', orgId)
    .gte('delivery_date', periodFrom)
    .lte('delivery_date', periodTo));

  const todayDeliveries = unwrap(await supabase
    .from('deliveries')
    .select('customer_id, total_amount, amount_paid, payment_mode, staff:users(id, name), vehicle:vehicles(id, vehicle_number, driver_name)')
    .eq('organization_id', orgId)
    .eq('delivery_date', today));
  const vehicleOrg = req.organization.delivery_model === 'vehicle_eod';

  const notificationWindowStart = new Date(Date.now() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [activeCustomers, todaySkips, pendingDuesResults, newDeviceLogins, inactiveCustomerDeliveries] = await Promise.all([
    supabase.from('customers').select('id, name, assigned_staff:users(name)').eq('organization_id', orgId).eq('status', 'active').then(unwrap),
    supabase.from('route_skips').select('customer_id').eq('organization_id', orgId).eq('skip_date', today).then(unwrap),
    // Reuses pendingDues.controller.js's aggregation so "who owes what, since
    // when" is computed identically here and on the Pending Dues page.
    computePendingDues({ organizationId: orgId, minAgeDays: HIGH_OVERDUE_MIN_AGE_DAYS }),
    supabase.from('activity_events').select('metadata, created_at, user:users(name)')
      .eq('organization_id', orgId).eq('event_type', 'new_device_login').gte('created_at', notificationWindowStart)
      .order('created_at', { ascending: false }).then(unwrap),
    supabase.from('activity_events').select('metadata, created_at')
      .eq('organization_id', orgId).eq('event_type', 'delivery_for_inactive_customer').gte('created_at', notificationWindowStart)
      .order('created_at', { ascending: false }).then(unwrap),
  ]);

  const highOverdueCustomers = pendingDuesResults
    .filter((r) => r.total_due > HIGH_OVERDUE_THRESHOLD)
    .map((r) => ({ id: r.customer.id, name: r.customer.name, total_due: r.total_due, days_pending: r.days_pending }));

  let periodSales = 0;
  let periodCollected = 0;
  const dailyMap = new Map();
  const statusBreakdown = {
    paid: { count: 0, amount: 0 },
    partial: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
  };

  for (const d of periodDeliveries) {
    const total = parseFloat(d.total_amount);
    const paid = parseFloat(d.amount_paid);
    periodSales += total;
    periodCollected += paid;

    const entry = dailyMap.get(d.delivery_date) || { date: d.delivery_date, sales_value: 0, collected: 0, orders_count: 0 };
    entry.sales_value += total;
    entry.collected += paid;
    entry.orders_count += 1;
    dailyMap.set(d.delivery_date, entry);

    const bucket = statusBreakdown[d.payment_status];
    if (bucket) {
      bucket.count += 1;
      bucket.amount += Math.max(total - paid, 0);
    }
  }

  const daily = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      date: e.date,
      sales_value: Math.round(e.sales_value * 100) / 100,
      collected: Math.round(e.collected * 100) / 100,
      orders_count: e.orders_count,
    }));

  let todaySales = 0;
  let todayCollected = 0;
  const byStaffMap = new Map();
  const byVehicleMap = new Map();
  const paymentModeBreakdown = {};
  const deliveredCustomerIds = new Set();
  for (const d of todayDeliveries) {
    const total = parseFloat(d.total_amount);
    const paid = parseFloat(d.amount_paid);
    todaySales += total;
    todayCollected += paid;
    deliveredCustomerIds.add(d.customer_id);

    if (vehicleOrg) {
      const key = d.vehicle ? d.vehicle.id : 'none';
      const vehicleEntry = byVehicleMap.get(key) || {
        vehicle_id: d.vehicle ? d.vehicle.id : null,
        vehicle_number: d.vehicle ? d.vehicle.vehicle_number : '—',
        driver_name: d.vehicle ? d.vehicle.driver_name : null,
        orders_count: 0,
        sales_value: 0,
        collected: 0,
      };
      vehicleEntry.orders_count += 1;
      vehicleEntry.sales_value += total;
      vehicleEntry.collected += paid;
      byVehicleMap.set(key, vehicleEntry);
    }

    const staffName = d.staff?.name || '—';
    const entry = byStaffMap.get(staffName) || { staff_name: staffName, orders_count: 0, sales_value: 0 };
    entry.orders_count += 1;
    entry.sales_value += total;
    byStaffMap.set(staffName, entry);

    if (paid > 0) {
      const mode = d.payment_mode || 'other';
      paymentModeBreakdown[mode] = (paymentModeBreakdown[mode] || 0) + paid;
    }
  }

  const skippedCustomerIds = new Set(todaySkips.map((s) => s.customer_id));
  const unloggedCustomers = activeCustomers.filter((c) => !deliveredCustomerIds.has(c.id) && !skippedCustomerIds.has(c.id));

  res.json({
    stats: {
      period_orders: periodDeliveries.length,
      period_sales_value: Math.round(periodSales * 100) / 100,
      period_collected: Math.round(periodCollected * 100) / 100,
      period_pending: Math.round((periodSales - periodCollected) * 100) / 100,
      today_orders: todayDeliveries.length,
      today_sales_value: Math.round(todaySales * 100) / 100,
      today_collected: Math.round(todayCollected * 100) / 100,
    },
    daily,
    payment_status_breakdown: Object.entries(statusBreakdown).map(([status, v]) => ({
      status,
      count: v.count,
      amount: Math.round(v.amount * 100) / 100,
    })),
    today_by_staff: Array.from(byStaffMap.values()).sort((a, b) => b.orders_count - a.orders_count),
    // Only for vehicle_eod orgs, where "who delivered today" means which
    // vehicle, not which office staff member keyed the entry in.
    today_by_vehicle: Array.from(byVehicleMap.values())
      .map((v) => ({
        ...v,
        sales_value: Math.round(v.sales_value * 100) / 100,
        collected: Math.round(v.collected * 100) / 100,
        pending: Math.round((v.sales_value - v.collected) * 100) / 100,
      }))
      .sort((a, b) => b.orders_count - a.orders_count),
    // Today's Route Status widget + the "unlogged deliveries" alert (Org
    // Admin dashboard) — active customers org-wide, not scoped to one staff
    // member the way todayBoard (delivery.controller.js) is. Both only make
    // sense when staff log live along a route: a vehicle_eod org keys the day
    // in at the end and not every customer is served daily, so "who hasn't
    // been logged yet" would just be noise there.
    route_status_today: vehicleOrg ? null : {
      total: activeCustomers.length,
      delivered: deliveredCustomerIds.size,
      skipped: skippedCustomerIds.size,
      pending: Math.max(activeCustomers.length - deliveredCustomerIds.size - skippedCustomerIds.size, 0),
    },
    unlogged_customers_today: vehicleOrg ? [] : unloggedCustomers.map((c) => ({ id: c.id, name: c.name, assigned_staff_name: c.assigned_staff?.name || null })),
    payment_mode_breakdown_today: Object.entries(paymentModeBreakdown).map(([mode, amount]) => ({ mode, amount: Math.round(amount * 100) / 100 })),
    // Smart Notifications (Part 3) — each one an in-app alert, same rationale
    // as unlogged_customers_today above: no push/SMS infra exists, so these
    // all surface as Dashboard widgets rather than OS notifications.
    high_overdue_customers: highOverdueCustomers,
    recent_new_device_logins: newDeviceLogins.map((e) => ({ user_name: e.user?.name || '—', created_at: e.created_at })),
    recent_inactive_customer_deliveries: inactiveCustomerDeliveries.map((e) => ({ customer_name: e.metadata?.customer_name || '—', delivery_id: e.metadata?.delivery_id, created_at: e.created_at })),
    monthly_summary_available: new Date().getDate() <= MONTHLY_SUMMARY_WINDOW_DAYS,
  });
});

module.exports = { getDashboard };
