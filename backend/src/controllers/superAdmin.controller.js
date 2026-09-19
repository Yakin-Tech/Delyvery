const supabase = require('../config/supabaseClient');
const { hashPassword, signToken } = require('../services/auth.service');
const { recordAudit } = require('../services/auditLog.service');
const { serializeUser } = require('./auth.controller');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { unwrapPage } = unwrap;
const { parsePagination } = require('../utils/paginate');

async function countWhere(table, column, value) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
  if (error) throw new ApiError(500, error.message);
  return count || 0;
}

const stats = asyncHandler(async (req, res) => {
  const [
    { count: totalOrgs },
    { count: activeOrgs },
    { count: trialOrgs },
    { count: suspendedOrgs },
    { count: totalCustomers },
    { count: totalStaff },
    { count: totalOrgAdmins },
  ] = await Promise.all([
    supabase.from('organizations').select('*', { count: 'exact', head: true }),
    supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'trial'),
    supabase.from('organizations').select('*', { count: 'exact', head: true }).eq('status', 'suspended'),
    supabase.from('customers').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'staff'),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'org_admin'),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const deliveriesThisMonth = unwrap(await supabase
    .from('deliveries')
    .select('total_amount')
    .gte('delivery_date', monthStartStr));

  const paymentsThisMonth = unwrap(await supabase
    .from('payments')
    .select('amount')
    .gte('payment_date', monthStartStr));

  res.json({
    organizations: { total: totalOrgs, active: activeOrgs, trial: trialOrgs, suspended: suspendedOrgs },
    users: { staff: totalStaff, org_admins: totalOrgAdmins },
    customers: { total: totalCustomers },
    this_month: {
      deliveries_count: deliveriesThisMonth.length,
      sales_value: deliveriesThisMonth.reduce((sum, d) => sum + parseFloat(d.total_amount), 0),
      collected: paymentsThisMonth.reduce((sum, p) => sum + parseFloat(p.amount), 0),
    },
  });
});

const listOrganizations = asyncHandler(async (req, res) => {
  const { search, status, business_type } = req.query;
  const pg = parsePagination(req.query);

  let query = supabase.from('organizations').select('*', { count: 'exact' });
  if (status) query = query.eq('status', status);
  if (business_type) query = query.eq('business_type', business_type);
  if (search) query = query.ilike('name', `%${search.replace(/[,()*%]/g, ' ').trim()}%`);

  const { data: organizations, count } = unwrapPage(await query.order('created_at', { ascending: false }).range(pg.from, pg.to));

  const augmented = await Promise.all(organizations.map(async (org) => {
    const [customerCount, lastDelivery] = await Promise.all([
      countWhere('customers', 'organization_id', org.id),
      supabase.from('deliveries').select('created_at').eq('organization_id', org.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      ...org,
      customer_count: customerCount,
      last_active_at: lastDelivery.data?.created_at || org.updated_at,
    };
  }));

  res.json(pg.buildResult(augmented, count));
});

// No principled default exists for a free-text "other" business type, so it
// falls back to the same litre default as water/milk — easy for the org
// admin to change in Settings either way.
const DEFAULT_UNIT_BY_BUSINESS_TYPE = { water: 'litre', milk: 'litre', gas: 'cylinder' };

const createOrganization = asyncHandler(async (req, res) => {
  const { name, business_type, address, phone_numbers, admin_name, admin_phone, admin_password, delivery_model } = req.body;

  const existingAdmin = unwrap(await supabase.from('users').select('id').eq('phone', admin_phone).maybeSingle());
  if (existingAdmin) throw ApiError.conflict('A user with this phone number already exists');

  const admin_password_hash = await hashPassword(admin_password);
  const unit_of_measure = DEFAULT_UNIT_BY_BUSINESS_TYPE[business_type] || 'litre';

  const rows = unwrap(await supabase.rpc('create_organization_with_admin', {
    p_name: name,
    p_business_type: business_type,
    p_address: address || null,
    p_phone_numbers: phone_numbers && phone_numbers.length ? phone_numbers : [],
    p_created_by: req.user.id,
    p_admin_name: admin_name,
    p_admin_phone: admin_phone,
    p_admin_password_hash: admin_password_hash,
    p_unit_of_measure: unit_of_measure,
    p_delivery_model: delivery_model || 'route_staff',
  }));
  const { organization_id, admin_user_id } = rows[0];

  await recordAudit({
    organizationId: organization_id,
    userId: req.user.id,
    action: 'organization_created',
    metadata: { name, business_type, admin_user_id, admin_phone, delivery_model: delivery_model || 'route_staff' },
  });

  const organization = unwrap(await supabase.from('organizations').select('*').eq('id', organization_id).single());
  res.status(201).json(organization);
});

const getOrganization = asyncHandler(async (req, res) => {
  const organization = unwrap(await supabase.from('organizations').select('*').eq('id', req.params.id).maybeSingle());
  if (!organization) throw ApiError.notFound('Organization not found');

  const [admins, customerCount, staffCount, deliveryCount, recentAuditLog] = await Promise.all([
    supabase.from('users').select('id, name, phone, status, created_at').eq('organization_id', organization.id).eq('role', 'org_admin').order('created_at', { ascending: true }).then(unwrap),
    countWhere('customers', 'organization_id', organization.id),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('organization_id', organization.id).eq('role', 'staff').then(({ count }) => count || 0),
    countWhere('deliveries', 'organization_id', organization.id),
    supabase.from('audit_logs').select('*, user:users(id, name)').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(20).then(unwrap),
  ]);

  res.json({
    organization,
    admins,
    stats: {
      customer_count: customerCount,
      staff_count: staffCount,
      delivery_count: deliveryCount,
    },
    recent_audit_log: recentAuditLog,
  });
});

const updateOrganization = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('organizations').select('*').eq('id', req.params.id).maybeSingle());
  if (!existing) throw ApiError.notFound('Organization not found');

  const fields = ['name', 'business_type', 'address', 'phone_numbers', 'status', 'delivery_model'];
  const patch = {};
  for (const field of fields) {
    if (req.body[field] !== undefined) patch[field] = req.body[field];
  }

  const organization = unwrap(await supabase.from('organizations').update(patch).eq('id', req.params.id).select('*').single());

  if (patch.status && patch.status !== existing.status) {
    await recordAudit({
      organizationId: organization.id,
      userId: req.user.id,
      action: 'organization_status_changed',
      metadata: { from: existing.status, to: patch.status },
    });
  }

  if (patch.delivery_model && patch.delivery_model !== existing.delivery_model) {
    await recordAudit({
      organizationId: organization.id,
      userId: req.user.id,
      action: 'organization_delivery_model_changed',
      metadata: { from: existing.delivery_model, to: patch.delivery_model },
    });
  }

  res.json(organization);
});

const createOrgAdmin = asyncHandler(async (req, res) => {
  const organization = unwrap(await supabase.from('organizations').select('id, name').eq('id', req.params.id).maybeSingle());
  if (!organization) throw ApiError.notFound('Organization not found');

  const { name, phone, password } = req.body;

  const existing = unwrap(await supabase.from('users').select('id').eq('phone', phone).maybeSingle());
  if (existing) throw ApiError.conflict('A user with this phone number already exists');

  const password_hash = await hashPassword(password);
  const admin = unwrap(await supabase.from('users').insert({
    organization_id: organization.id,
    role: 'org_admin',
    name,
    phone,
    password_hash,
    created_by: req.user.id,
  }).select('id, name, phone, status, created_at').single());

  await recordAudit({
    organizationId: organization.id,
    userId: req.user.id,
    action: 'org_admin_created',
    metadata: { admin_user_id: admin.id, phone },
  });

  res.status(201).json(admin);
});

const updateOrgAdminStatus = asyncHandler(async (req, res) => {
  const { orgId, userId } = req.params;
  const { status } = req.body;

  const admin = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', userId).maybeSingle());
  if (!admin || admin.organization_id !== orgId || admin.role !== 'org_admin') {
    throw ApiError.notFound('Org admin not found');
  }

  const updated = unwrap(await supabase.from('users').update({ status }).eq('id', userId).select('id, name, phone, status').single());

  await recordAudit({
    organizationId: orgId,
    userId: req.user.id,
    action: status === 'active' ? 'org_admin_activated' : 'org_admin_deactivated',
    metadata: { admin_user_id: userId },
  });

  res.json(updated);
});

// Super Admin resetting an Org Admin's password — same no-old-password-needed
// shape as staff.controller.js's resetPassword (staff.controller.js is an org
// admin resetting a staff member's; this is the level above, for when the org
// admin themself is the one locked out).
const resetOrgAdminPassword = asyncHandler(async (req, res) => {
  const { orgId, userId } = req.params;

  const admin = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', userId).maybeSingle());
  if (!admin || admin.organization_id !== orgId || admin.role !== 'org_admin') {
    throw ApiError.notFound('Org admin not found');
  }

  const password_hash = await hashPassword(req.body.password);
  unwrap(await supabase.from('users').update({ password_hash }).eq('id', userId).select('id').single());

  res.json({ success: true });
});

const impersonate = asyncHandler(async (req, res) => {
  const organization = unwrap(await supabase.from('organizations').select('*').eq('id', req.params.id).maybeSingle());
  if (!organization) throw ApiError.notFound('Organization not found');

  let target;
  if (req.body.as_user_id) {
    target = unwrap(await supabase.from('users').select('*').eq('id', req.body.as_user_id).maybeSingle());
    if (!target || target.organization_id !== organization.id || target.role !== 'org_admin') {
      throw ApiError.badRequest('That user is not an org admin for this organization');
    }
  } else {
    target = unwrap(await supabase
      .from('users')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('role', 'org_admin')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle());
    if (!target) throw ApiError.badRequest('This organization has no active org admin to impersonate');
  }

  const token = signToken(
    { id: target.id, role: target.role, organizationId: target.organization_id },
    { impersonatedBy: req.user.id }
  );

  await recordAudit({
    organizationId: organization.id,
    userId: req.user.id,
    action: 'impersonation_started',
    metadata: { target_user_id: target.id, target_phone: target.phone },
  });

  res.json({
    token,
    user: serializeUser(target),
    organization,
    impersonated_by: req.user.id,
  });
});

const listAuditLog = asyncHandler(async (req, res) => {
  const { organization_id, user_id, action } = req.query;
  const pg = parsePagination(req.query);

  let query = supabase.from('audit_logs').select('*, user:users(id, name), organization:organizations(id, name)', { count: 'exact' });
  if (organization_id) query = query.eq('organization_id', organization_id);
  if (user_id) query = query.eq('user_id', user_id);
  if (action) query = query.eq('action', action);

  const { data, count } = unwrapPage(await query.order('created_at', { ascending: false }).range(pg.from, pg.to));
  res.json(pg.buildResult(data, count));
});

// Two lightweight chart datasets for the Super Admin Overview page, both built
// by fetching the raw rows in range and reducing in JS — same approach as
// pendingDues.controller.js, no new SQL needed.
const timeseries = asyncHandler(async (req, res) => {
  const dayCount = 30;
  const startDate = new Date(Date.now() - (dayCount - 1) * 24 * 60 * 60 * 1000);
  const startDateStr = startDate.toISOString().slice(0, 10);

  const deliveries = unwrap(await supabase
    .from('deliveries')
    .select('delivery_date, total_amount, amount_paid')
    .gte('delivery_date', startDateStr));

  const byDate = new Map();
  for (let i = 0; i < dayCount; i += 1) {
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDate.set(d, { date: d, deliveries_count: 0, sales_value: 0, collected: 0 });
  }
  for (const delivery of deliveries) {
    const entry = byDate.get(delivery.delivery_date);
    if (!entry) continue;
    entry.deliveries_count += 1;
    entry.sales_value += parseFloat(delivery.total_amount);
    entry.collected += parseFloat(delivery.amount_paid);
  }
  const daily = Array.from(byDate.values()).map((e) => ({
    ...e,
    sales_value: Math.round(e.sales_value * 100) / 100,
    collected: Math.round(e.collected * 100) / 100,
  }));

  const weekCount = 12;
  const growthStart = new Date(Date.now() - (weekCount * 7 - 1) * 24 * 60 * 60 * 1000);
  const organizations = unwrap(await supabase
    .from('organizations')
    .select('created_at')
    .order('created_at', { ascending: true }));

  const baselineCount = organizations.filter((o) => new Date(o.created_at) < growthStart).length;
  const orgGrowth = [];
  for (let i = 0; i < weekCount; i += 1) {
    const weekStart = new Date(growthStart.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const createdByWeekEnd = organizations.filter((o) => new Date(o.created_at) < weekEnd).length;
    orgGrowth.push({
      week_start: weekStart.toISOString().slice(0, 10),
      cumulative_orgs: Math.max(createdByWeekEnd, baselineCount),
    });
  }

  res.json({ daily, org_growth: orgGrowth });
});

// Platform Health: DAU/MAU (from activity_events login rows — see
// activityLog.service.js) and which orgs have gone quiet in the past week
// (candidates for a "hey, everything okay?" outreach), same
// fetch-raw-rows-and-reduce-in-JS approach as timeseries() above.
const activityStats = asyncHandler(async (req, res) => {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [dailyLogins, monthlyLogins, weekLogins, weekDeliveries, organizations] = await Promise.all([
    supabase.from('activity_events').select('user_id').eq('event_type', 'login').gte('created_at', dayAgo).then(unwrap),
    supabase.from('activity_events').select('user_id').eq('event_type', 'login').gte('created_at', monthAgo).then(unwrap),
    supabase.from('activity_events').select('organization_id').eq('event_type', 'login').gte('created_at', weekAgo).then(unwrap),
    supabase.from('deliveries').select('organization_id').gte('delivery_date', weekAgo.slice(0, 10)).then(unwrap),
    supabase.from('organizations').select('id, name, status').then(unwrap),
  ]);

  const activeOrgIdsThisWeek = new Set([
    ...weekLogins.map((r) => r.organization_id).filter(Boolean),
    ...weekDeliveries.map((r) => r.organization_id).filter(Boolean),
  ]);

  const inactiveOrgs = organizations.filter((o) => !activeOrgIdsThisWeek.has(o.id) && o.status !== 'suspended');

  res.json({
    dau: new Set(dailyLogins.map((r) => r.user_id)).size,
    mau: new Set(monthlyLogins.map((r) => r.user_id)).size,
    inactive_orgs_7d: inactiveOrgs.map((o) => ({ id: o.id, name: o.name, status: o.status })),
  });
});

// Platform Health: server error counts per org, trailing 24h/7d — flags an
// org whose integration/usage is hitting API errors frequently. Only 5xx
// responses ever reach activity_events as event_type 'error' — see
// middleware/errorHandler.js.
const errorStats = asyncHandler(async (req, res) => {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [dayErrors, weekErrors, organizations] = await Promise.all([
    supabase.from('activity_events').select('organization_id').eq('event_type', 'error').gte('created_at', dayAgo).then(unwrap),
    supabase.from('activity_events').select('organization_id').eq('event_type', 'error').gte('created_at', weekAgo).then(unwrap),
    supabase.from('organizations').select('id, name').then(unwrap),
  ]);

  const orgNameById = new Map(organizations.map((o) => [o.id, o.name]));
  const countByOrg = (rows) => {
    const counts = new Map();
    for (const r of rows) {
      if (!r.organization_id) continue;
      counts.set(r.organization_id, (counts.get(r.organization_id) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([organization_id, count]) => ({ organization_id, organization_name: orgNameById.get(organization_id) || '—', count }))
      .sort((a, b) => b.count - a.count);
  };

  res.json({
    total_errors_24h: dayErrors.length,
    total_errors_7d: weekErrors.length,
    by_organization_24h: countByOrg(dayErrors),
    by_organization_7d: countByOrg(weekErrors),
  });
});

// Onboarding Pipeline: Created -> First Login -> First Customer -> First
// Delivery -> 7-Day Active, so it's visible where new orgs drop off. Derived
// entirely from existing timestamps plus activity_events login rows — no
// separate funnel-tracking table (see the activity_events comment in
// schema.sql).
const onboardingFunnel = asyncHandler(async (req, res) => {
  const [organizations, logins, customers, deliveries] = await Promise.all([
    supabase.from('organizations').select('id, created_at').then(unwrap),
    supabase.from('activity_events').select('organization_id, created_at').eq('event_type', 'login').order('created_at', { ascending: true }).then(unwrap),
    supabase.from('customers').select('organization_id, created_at').order('created_at', { ascending: true }).then(unwrap),
    supabase.from('deliveries').select('organization_id, created_at').order('created_at', { ascending: true }).then(unwrap),
  ]);

  const firstByOrg = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (!r.organization_id || map.has(r.organization_id)) continue;
      map.set(r.organization_id, r.created_at);
    }
    return map;
  };

  const firstLogin = firstByOrg(logins);
  const firstCustomer = firstByOrg(customers);
  const firstDelivery = firstByOrg(deliveries);

  // "Still active a week after their first login" — a later login/delivery
  // at least 7 days after that first login.
  const laterActivityByOrg = new Map();
  for (const r of [...logins, ...deliveries]) {
    if (!r.organization_id) continue;
    const list = laterActivityByOrg.get(r.organization_id) || [];
    list.push(r.created_at);
    laterActivityByOrg.set(r.organization_id, list);
  }

  let sevenDayActiveCount = 0;
  for (const org of organizations) {
    const firstLoginAt = firstLogin.get(org.id);
    if (!firstLoginAt) continue;
    const cutoff = new Date(firstLoginAt).getTime() + 7 * 24 * 60 * 60 * 1000;
    const laterEvents = laterActivityByOrg.get(org.id) || [];
    if (laterEvents.some((t) => new Date(t).getTime() >= cutoff)) sevenDayActiveCount += 1;
  }

  res.json({
    stages: [
      { stage: 'created', count: organizations.length },
      { stage: 'first_login', count: firstLogin.size },
      { stage: 'first_customer', count: firstCustomer.size },
      { stage: 'first_delivery', count: firstDelivery.size },
      { stage: 'seven_day_active', count: sevenDayActiveCount },
    ],
  });
});

// Platform Health: top orgs by delivery volume in the trailing 30 days — the
// most active/valuable customers on the platform.
const topOrgsByVolume = asyncHandler(async (req, res) => {
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [deliveries, organizations] = await Promise.all([
    supabase.from('deliveries').select('organization_id, total_amount').gte('delivery_date', monthAgo).then(unwrap),
    supabase.from('organizations').select('id, name').then(unwrap),
  ]);

  const orgNameById = new Map(organizations.map((o) => [o.id, o.name]));
  const byOrg = new Map();
  for (const d of deliveries) {
    const entry = byOrg.get(d.organization_id) || { organization_id: d.organization_id, organization_name: orgNameById.get(d.organization_id) || '—', deliveries_count: 0, sales_value: 0 };
    entry.deliveries_count += 1;
    entry.sales_value += parseFloat(d.total_amount);
    byOrg.set(d.organization_id, entry);
  }

  const top = Array.from(byOrg.values())
    .map((e) => ({ ...e, sales_value: Math.round(e.sales_value * 100) / 100 }))
    .sort((a, b) => b.deliveries_count - a.deliveries_count)
    .slice(0, 10);

  res.json(top);
});

module.exports = {
  stats,
  timeseries,
  listOrganizations,
  createOrganization,
  getOrganization,
  updateOrganization,
  createOrgAdmin,
  updateOrgAdminStatus,
  resetOrgAdminPassword,
  impersonate,
  listAuditLog,
  activityStats,
  errorStats,
  onboardingFunnel,
  topOrgsByVolume,
};
