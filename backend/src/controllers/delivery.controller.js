const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { unwrapPage } = unwrap;
const { parsePagination } = require('../utils/paginate');
const sanitizeSearchTerm = require('../utils/sanitizeSearchTerm');
const { recordActivity } = require('../services/activityLog.service');

const DELIVERY_SELECT = '*, customer:customers(id, name, phone), staff:users(id, name), product:products(id, name, unit_of_measure), vehicle:vehicles(id, vehicle_number, driver_name, label)';

const isVehicleOrg = (req) => req.organization.delivery_model === 'vehicle_eod';

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Normalizes {quantity, unit_price, total_amount, payment_status, amount_paid} into
// consistent, stored values. Shared by create and update so the rules never drift.
function resolveAmounts({ quantity, unit_price, total_amount, payment_status, amount_paid }) {
  const computedTotal = total_amount !== undefined && total_amount !== null
    ? parseFloat(total_amount)
    : parseFloat(quantity) * parseFloat(unit_price);

  let resolvedAmountPaid;
  if (payment_status === 'paid') {
    resolvedAmountPaid = computedTotal;
  } else if (payment_status === 'pending') {
    resolvedAmountPaid = 0;
  } else {
    // partial
    resolvedAmountPaid = amount_paid !== undefined && amount_paid !== null ? parseFloat(amount_paid) : 0;
    if (resolvedAmountPaid <= 0 || resolvedAmountPaid >= computedTotal) {
      throw ApiError.badRequest('A partial payment must be greater than 0 and less than the total amount');
    }
  }

  return { total_amount: computedTotal, amount_paid: resolvedAmountPaid };
}

async function assertProductVisible(req, productId) {
  if (!productId) return null;
  const product = unwrap(await supabase.from('products').select('id, organization_id, default_price').eq('id', productId).maybeSingle());
  if (!product || product.organization_id !== req.user.organizationId) {
    throw ApiError.badRequest('Product not found in your organization');
  }
  return product;
}

async function assertVehicleVisible(req, vehicleId) {
  if (!vehicleId) return null;
  const vehicle = unwrap(await supabase.from('vehicles').select('id, organization_id').eq('id', vehicleId).maybeSingle());
  if (!vehicle || vehicle.organization_id !== req.user.organizationId) {
    throw ApiError.badRequest('Vehicle not found in your organization');
  }
  return vehicle;
}

// In a vehicle_eod org a customer belongs to a vehicle, never to a staff
// member, and the staff typing in an end-of-day note aren't tied to any subset
// of customers — so the per-staff visibility/"can add customers" switches
// (which exist for the route_staff model) don't apply there.
async function assertCustomerVisible(req, customerId) {
  const customer = unwrap(await supabase.from('customers').select('id, organization_id, assigned_staff_id').eq('id', customerId).maybeSingle());
  if (!customer || customer.organization_id !== req.user.organizationId) {
    throw ApiError.badRequest('Customer not found in your organization');
  }
  if (req.user.role === 'staff' && !isVehicleOrg(req) && !req.organization.staff_sees_all_customers) {
    if (customer.assigned_staff_id !== req.user.id) {
      throw ApiError.forbidden('This customer is not assigned to you');
    }
  }
  return customer;
}

// Logging a delivery for someone not in the system yet creates them as a
// customer first (same shape customer.controller.js's create writes), then
// the delivery proceeds against that new id. A staff member can only do this
// when the org has opted them into adding customers — the same gate that
// already governs the standalone "add customer" action, since this is that
// same action taken through a different door.
//
// If the given phone already belongs to a customer in this org, that existing
// customer is reused instead of inserting a duplicate — phone is meant to be
// a stable identity within the org (enforced DB-side too, see the unique
// index on customers(organization_id, phone) in schema.sql), so two people
// logging a delivery for "someone new" who happens to already be a customer
// must land on the same row, not create a second one.
async function resolveCustomerId(req, { customer_id, new_customer, vehicle_id }) {
  if (customer_id) {
    const customer = await assertCustomerVisible(req, customer_id);
    return customer.id;
  }

  if (req.user.role === 'staff' && !isVehicleOrg(req) && !req.organization.staff_can_add_customers) {
    throw ApiError.forbidden('Staff are not permitted to add customers for this organization');
  }

  if (new_customer.phone) {
    // .limit(1) instead of .maybeSingle(): an org whose data predates the
    // phone-uniqueness fix (see schema.sql) may still have leftover
    // duplicates for this phone until they re-run it — falling back to the
    // oldest match keeps this working instead of throwing on >1 row.
    const [existing] = unwrap(await supabase.from('customers')
      .select('id')
      .eq('organization_id', req.user.organizationId)
      .eq('phone', new_customer.phone)
      .order('created_at', { ascending: true })
      .limit(1));
    if (existing) return existing.id;
  }

  const created = unwrap(await supabase.from('customers').insert({
    organization_id: req.user.organizationId,
    name: new_customer.name,
    phone: new_customer.phone || null,
    default_quantity: 1,
    custom_price_per_unit: null,
    // A new customer joins the vehicle whose note they appeared on; the
    // route_staff model instead hands them to the staff member who logged them.
    assigned_staff_id: isVehicleOrg(req) ? null : (req.user.role === 'staff' ? req.user.id : null),
    assigned_vehicle_id: isVehicleOrg(req) ? (vehicle_id || null) : null,
  }).select('id').single());

  return created.id;
}

// Applies every list filter shared by the paginated fetch and the unranged
// totals fetch, so the two queries always describe the same filtered set.
function applyListFilters(query, req) {
  const { customer_id, staff_id, vehicle_id, payment_status, date_from, date_to, place, product_id } = req.query;

  query = query.eq('organization_id', requireOrgId(req));

  if (req.user.role === 'staff') {
    query = query.eq('staff_id', req.user.id);
  } else if (staff_id) {
    query = query.eq('staff_id', staff_id);
  }

  if (vehicle_id) query = query.eq('vehicle_id', vehicle_id);
  if (customer_id) query = query.eq('customer_id', customer_id);
  if (payment_status) query = query.eq('payment_status', payment_status);
  if (date_from) query = query.gte('delivery_date', date_from);
  if (date_to) query = query.lte('delivery_date', date_to);
  if (place) query = query.eq('place', place);
  if (product_id) query = query.eq('product_id', product_id);

  return query;
}

// Deliveries don't carry the customer's name/phone directly (they're on the
// related customers row), so a text search resolves matching customer ids
// first, then filters deliveries by customer_id — same two-step shape as the
// old zone filter used to need, for the same reason (PostgREST can't filter
// an embedded resource's columns and page the outer table correctly at once
// without an !inner join, which pagination totals here don't want either).
async function resolveSearchCustomerIds(req, search) {
  if (!search) return null;
  const term = sanitizeSearchTerm(search);
  if (!term) return null;
  const matches = unwrap(await supabase.from('customers')
    .select('id')
    .eq('organization_id', requireOrgId(req))
    .or(`name.ilike.%${term}%,phone.ilike.%${term}%`));
  return matches.map((c) => c.id);
}

const list = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const searchIds = await resolveSearchCustomerIds(req, req.query.search);

  if (searchIds !== null && searchIds.length === 0) {
    return res.json(pg.buildResult([], 0, { totals: { total_value: 0, total_collected: 0, total_pending: 0 } }));
  }

  let pagedQuery = applyListFilters(supabase.from('deliveries').select(DELIVERY_SELECT, { count: 'exact' }), req);
  if (searchIds !== null) pagedQuery = pagedQuery.in('customer_id', searchIds);
  const { data, count } = unwrapPage(await pagedQuery
    .order('delivery_date', { ascending: false })
    .order('delivery_time', { ascending: false })
    .range(pg.from, pg.to));

  let totalsQuery = applyListFilters(supabase.from('deliveries').select('total_amount, amount_paid'), req);
  if (searchIds !== null) totalsQuery = totalsQuery.in('customer_id', searchIds);
  const rowsForTotals = unwrap(await totalsQuery);
  const totals = rowsForTotals.reduce((acc, d) => {
    acc.total_value += parseFloat(d.total_amount);
    acc.total_collected += parseFloat(d.amount_paid);
    return acc;
  }, { total_value: 0, total_collected: 0 });
  totals.total_pending = Math.round((totals.total_value - totals.total_collected) * 100) / 100;
  totals.total_value = Math.round(totals.total_value * 100) / 100;
  totals.total_collected = Math.round(totals.total_collected * 100) / 100;

  res.json(pg.buildResult(data, count, { totals }));
});

// Data-quality flag for the Org Admin dashboard (spec: "Delivery logged for a
// deactivated customer") — deliberately never blocks the delivery itself,
// since assertCustomerVisible/resolveCustomerId only ever check org/staff
// visibility, not active status: a customer marked inactive can still get a
// delivery logged against them today, and this just surfaces that it
// happened rather than silently allowing it with no trace. Best-effort —
// never lets a lookup failure affect the actual delivery.
async function flagIfCustomerInactive(req, customerId, deliveryId) {
  try {
    const { data: customer } = await supabase.from('customers').select('id, name, status').eq('id', customerId).maybeSingle();
    if (customer && customer.status !== 'active') {
      recordActivity({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        eventType: 'delivery_for_inactive_customer',
        metadata: { delivery_id: deliveryId, customer_id: customer.id, customer_name: customer.name },
      });
    }
  } catch (err) {
    console.error('Failed to check customer status for inactive-delivery flag:', err.message);
  }
}

// Shared by create() and the offline sync-batch path (syncBatch below) so the
// two never drift on what "logging a delivery" actually does. client_ref_id
// is only meaningful for the sync-batch path (see schema.sql comment on
// deliveries.client_ref_id) — plain create() never sets it.
async function insertDelivery(req, { customer_id, vehicle_id, product_id, quantity, unit_price, total_amount, payment_status, amount_paid, payment_mode, delivery_date, place, notes, client_ref_id }) {
  const amounts = resolveAmounts({ quantity, unit_price, total_amount, payment_status, amount_paid });

  let delivery = unwrap(await supabase.from('deliveries').insert({
    organization_id: req.user.organizationId,
    customer_id,
    staff_id: req.user.id,
    vehicle_id: vehicle_id || null,
    product_id: product_id || null,
    delivery_date: delivery_date || todayISODate(),
    quantity,
    unit_price_at_delivery: unit_price,
    total_amount: amounts.total_amount,
    payment_status,
    amount_paid: amounts.amount_paid,
    payment_mode: payment_mode || (payment_status === 'pending' ? null : 'cash'),
    place: place || null,
    notes: notes || null,
    client_ref_id: client_ref_id || null,
  }).select(DELIVERY_SELECT).single());

  // Draw down any credit the customer is carrying from a prior overpayment
  // (see apply_payment_fifo / apply_payment_manual) against this new due —
  // cheap no-op when they have none.
  const [creditResult] = unwrap(await supabase.rpc('apply_delivery_credit', {
    p_delivery_id: delivery.id,
    p_customer_id: customer_id,
  }));
  if (creditResult && creditResult.credit_applied > 0) {
    delivery = unwrap(await supabase.from('deliveries').select(DELIVERY_SELECT).eq('id', delivery.id).single());
  }

  flagIfCustomerInactive(req, customer_id, delivery.id);

  return delivery;
}

// Place suggestions for the delivery form's "place" field — scoped to one
// customer, since where they're delivered to only makes sense in that
// context. Only looks at the last 90 days so a place stops being suggested
// once it hasn't actually been delivered to again in a while, instead of
// suggestions accumulating forever. Ordered by most-recently-used first,
// deduped, capped at 8 — a fetch-and-reduce-in-JS on a small per-customer row
// set rather than a DISTINCT ON, which the supabase-js query builder can't
// express directly.
//
// A place explicitly dismissed (see dismissPlace below) via
// place_dismissals stays hidden even inside that 90-day window, but only
// until it's actually delivered to again: dismissed_at is compared against
// that place's own most-recent delivery_time, so a delivery logged after the
// dismissal makes the place reappear on its own — no separate "undo" needed.
const RECENT_PLACES_WINDOW_DAYS = 90;
const recentPlaces = asyncHandler(async (req, res) => {
  const { customer_id } = req.query;
  if (!customer_id) throw ApiError.badRequest('customer_id is required');
  await assertCustomerVisible(req, customer_id);

  const since = new Date(Date.now() - RECENT_PLACES_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [rows, dismissals] = await Promise.all([
    supabase.from('deliveries')
      .select('place, delivery_date, delivery_time')
      .eq('organization_id', requireOrgId(req))
      .eq('customer_id', customer_id)
      .not('place', 'is', null)
      .gte('delivery_date', since)
      .order('delivery_time', { ascending: false })
      .then(unwrap),
    supabase.from('place_dismissals')
      .select('place, dismissed_at')
      .eq('customer_id', customer_id)
      .then(unwrap),
  ]);

  const dismissedAtByPlace = new Map(dismissals.map((d) => [d.place, d.dismissed_at]));

  const seen = new Set();
  const places = [];
  for (const row of rows) {
    const place = row.place.trim();
    if (!place || seen.has(place)) continue;
    seen.add(place);

    const dismissedAt = dismissedAtByPlace.get(place);
    if (dismissedAt && new Date(dismissedAt) >= new Date(row.delivery_time)) continue;

    places.push(place);
    if (places.length >= 8) break;
  }

  res.json(places);
});

// "Remove this from suggestions" for one customer+place — see the
// place_dismissals comment in schema.sql. Upserts so dismissing an
// already-dismissed place just refreshes dismissed_at instead of erroring on
// the unique (customer_id, place) index.
const dismissPlace = asyncHandler(async (req, res) => {
  const { customer_id, place } = req.body;
  await assertCustomerVisible(req, customer_id);

  const trimmedPlace = (place || '').trim();
  if (!trimmedPlace) throw ApiError.badRequest('place is required');

  unwrap(await supabase.from('place_dismissals')
    .upsert({
      organization_id: req.user.organizationId,
      customer_id,
      place: trimmedPlace,
      dismissed_at: new Date().toISOString(),
      dismissed_by: req.user.id,
    }, { onConflict: 'customer_id,place' })
    .select('id').single());

  res.json({ success: true });
});

// In a vehicle_eod org every delivery must be attributable to a vehicle —
// vehicle-wise pending/collection reporting depends on it. An explicit
// vehicle_id wins; otherwise a delivery recorded against an existing customer
// (e.g. from their detail page) falls back to the vehicle that customer is
// assigned to. route_staff orgs never use vehicles, so this returns null there.
async function resolveVehicleId(req, vehicleId, customerId) {
  if (vehicleId) {
    await assertVehicleVisible(req, vehicleId);
    return vehicleId;
  }
  if (!isVehicleOrg(req)) return null;

  if (customerId) {
    const customer = unwrap(await supabase.from('customers').select('assigned_vehicle_id').eq('id', customerId).maybeSingle());
    if (customer && customer.assigned_vehicle_id) return customer.assigned_vehicle_id;
  }
  throw ApiError.badRequest('Choose the vehicle that made this delivery');
}

const create = asyncHandler(async (req, res) => {
  const { customer_id, new_customer, vehicle_id, product_id, quantity, unit_price, total_amount, payment_status, amount_paid, payment_mode, delivery_date, place, notes } = req.body;

  // Validate the vehicle before resolveCustomerId can create a new customer
  // row, so a bad/missing vehicle never leaves an orphan customer behind.
  if (vehicle_id) {
    await assertVehicleVisible(req, vehicle_id);
  } else if (isVehicleOrg(req) && !customer_id) {
    throw ApiError.badRequest('Choose the vehicle that made this delivery');
  }

  const resolvedCustomerId = await resolveCustomerId(req, { customer_id, new_customer, vehicle_id });
  await assertProductVisible(req, product_id);
  const resolvedVehicleId = await resolveVehicleId(req, vehicle_id, resolvedCustomerId);

  const delivery = await insertDelivery(req, { customer_id: resolvedCustomerId, vehicle_id: resolvedVehicleId, product_id, quantity, unit_price, total_amount, payment_status, amount_paid, payment_mode, delivery_date, place, notes });

  res.status(201).json(delivery);
});

const PAYMENT_STATUSES = ['paid', 'partial', 'pending'];
const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other'];

// Per-row checks for the end-of-day batch. The route-level validator is
// deliberately light (see delivery.validator.js) so one bad row can't 400 the
// whole day's note; anything wrong with a row is reported back as that row's
// own error instead, with a message the office staff can act on.
function assertBatchItemValid(item) {
  if (!item.customer_id && !(item.new_customer && item.new_customer.name && String(item.new_customer.name).trim())) {
    throw ApiError.badRequest('Choose a customer or enter a new customer name');
  }
  const quantity = parseFloat(item.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw ApiError.badRequest('Quantity must be greater than 0');
  const hasTotal = item.total_amount !== undefined && item.total_amount !== null && item.total_amount !== '';
  const unitPrice = parseFloat(item.unit_price);
  if (!hasTotal && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw ApiError.badRequest('Enter a price or a total amount');
  if (!PAYMENT_STATUSES.includes(item.payment_status)) throw ApiError.badRequest('Choose paid, partial or pending');
  if (item.payment_mode && !PAYMENT_MODES.includes(item.payment_mode)) throw ApiError.badRequest('Invalid payment mode');
}

// End-of-day entry for a vehicle_eod org: office staff transcribe one
// vehicle's paper note for one day as a single batch. Rows are independent
// (a bad row reports its own error, the rest still save) and idempotent by
// client_ref_id, so a double-tap or a retry after a dropped response returns
// "already_synced" for rows that already landed instead of duplicating them.
const vehicleEodBatch = asyncHandler(async (req, res) => {
  if (!isVehicleOrg(req)) {
    throw ApiError.badRequest('End-of-day vehicle entry is not enabled for this organization');
  }

  const orgId = requireOrgId(req);
  const { vehicle_id, entry_date, items } = req.body;
  await assertVehicleVisible(req, vehicle_id);
  const date = entry_date || todayISODate();

  const results = [];
  for (const item of items) {
    const clientRefId = item.client_ref_id || null;
    try {
      if (clientRefId) {
        const prior = unwrap(await supabase.from('deliveries')
          .select(DELIVERY_SELECT).eq('organization_id', orgId).eq('client_ref_id', clientRefId).maybeSingle());
        if (prior) {
          results.push({ client_ref_id: clientRefId, status: 'already_synced', delivery: prior });
          continue;
        }
      }

      assertBatchItemValid(item);
      const resolvedCustomerId = await resolveCustomerId(req, { customer_id: item.customer_id, new_customer: item.new_customer, vehicle_id });
      await assertProductVisible(req, item.product_id);

      // A driver's note may give only the line total, not a per-unit price.
      const hasUnitPrice = item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== '';
      const unitPrice = hasUnitPrice ? item.unit_price : parseFloat(item.total_amount) / parseFloat(item.quantity);

      const delivery = await insertDelivery(req, {
        ...item,
        unit_price: unitPrice,
        customer_id: resolvedCustomerId,
        vehicle_id,
        delivery_date: date,
        client_ref_id: clientRefId,
      });
      results.push({ client_ref_id: clientRefId, status: 'created', delivery });
    } catch (err) {
      results.push({ client_ref_id: clientRefId, status: 'error', message: err.message });
    }
  }

  res.json({ results });
});

// A staff member marking "no delivery today" for a route customer, with a
// reason (out of stock, customer not home, customer paused, etc.) — see the
// route_skips comment in schema.sql for why this isn't a deliveries row.
const skip = asyncHandler(async (req, res) => {
  const { customer_id, reason, skip_date } = req.body;
  const customer = await assertCustomerVisible(req, customer_id);
  const date = skip_date || todayISODate();

  const existingDelivery = unwrap(await supabase.from('deliveries')
    .select('id').eq('customer_id', customer.id).eq('delivery_date', date).maybeSingle());
  if (existingDelivery) {
    throw ApiError.conflict('A delivery is already logged for this customer today');
  }

  const skipRecord = unwrap(await supabase.from('route_skips').insert({
    organization_id: req.user.organizationId,
    customer_id: customer.id,
    staff_id: req.user.id,
    skip_date: date,
    reason,
  }).select('*').single());

  res.status(201).json(skipRecord);
});

// Flushes the staff app's offline queue (see frontend/src/offline/) in one
// call: each item is either a queued delivery or a queued skip, tagged with
// the client_ref_id it was created with while offline. Processed
// independently (one bad/conflicting item never fails the rest of the batch,
// since a flaky connection dropping mid-flush shouldn't force every other
// already-valid item to be resent from scratch) and resolved into one of:
//   - "created"        — inserted for the first time
//   - "already_synced" — this exact client_ref_id was already applied (safe
//                         retry after a response the client never saw)
//   - "conflict"        — someone else (an admin, or another device) already
//                         logged/skipped this customer for that date first;
//                         the client surfaces this for manual review instead
//                         of silently overwriting or duplicating it
//   - "error"           — the item itself was invalid (bad customer id, etc.)
const syncBatch = asyncHandler(async (req, res) => {
  const { items } = req.body;
  const results = [];

  for (const item of items) {
    const clientRefId = item.client_ref_id || null;
    try {
      if (item.kind === 'delivery') {
        const resolvedCustomerId = await resolveCustomerId(req, { customer_id: item.customer_id, new_customer: item.new_customer });
        await assertProductVisible(req, item.product_id);
        const date = item.delivery_date || todayISODate();

        const conflictingSkip = unwrap(await supabase.from('route_skips')
          .select('*').eq('customer_id', resolvedCustomerId).eq('skip_date', date).maybeSingle());
        if (conflictingSkip) {
          results.push({ client_ref_id: clientRefId, status: 'conflict', reason: 'already_skipped', existing: conflictingSkip });
          continue;
        }

        const existingDelivery = unwrap(await supabase.from('deliveries')
          .select(DELIVERY_SELECT).eq('customer_id', resolvedCustomerId).eq('delivery_date', date).maybeSingle());
        if (existingDelivery) {
          if (clientRefId && existingDelivery.client_ref_id === clientRefId) {
            results.push({ client_ref_id: clientRefId, status: 'already_synced', delivery: existingDelivery });
          } else {
            results.push({ client_ref_id: clientRefId, status: 'conflict', reason: 'already_delivered', existing: existingDelivery });
          }
          continue;
        }

        // vehicle_id: null — the live-route queue never carries vehicles, and
        // spreading the client's item here would otherwise let it store an
        // unvalidated vehicle id from any org.
        const delivery = await insertDelivery(req, { ...item, customer_id: resolvedCustomerId, vehicle_id: null, delivery_date: date, client_ref_id: clientRefId });
        results.push({ client_ref_id: clientRefId, status: 'created', delivery });
      } else if (item.kind === 'skip') {
        const customer = await assertCustomerVisible(req, item.customer_id);
        const date = item.skip_date || todayISODate();

        const existingDelivery = unwrap(await supabase.from('deliveries')
          .select('*').eq('customer_id', customer.id).eq('delivery_date', date).maybeSingle());
        if (existingDelivery) {
          results.push({ client_ref_id: clientRefId, status: 'conflict', reason: 'already_delivered', existing: existingDelivery });
          continue;
        }

        const existingSkip = unwrap(await supabase.from('route_skips')
          .select('*').eq('customer_id', customer.id).eq('skip_date', date).maybeSingle());
        if (existingSkip) {
          if (clientRefId && existingSkip.client_ref_id === clientRefId) {
            results.push({ client_ref_id: clientRefId, status: 'already_synced', skip: existingSkip });
          } else {
            results.push({ client_ref_id: clientRefId, status: 'conflict', reason: 'already_skipped', existing: existingSkip });
          }
          continue;
        }

        const skipRecord = unwrap(await supabase.from('route_skips').insert({
          organization_id: req.user.organizationId,
          customer_id: customer.id,
          staff_id: req.user.id,
          skip_date: date,
          reason: item.reason,
          client_ref_id: clientRefId,
        }).select('*').single());
        results.push({ client_ref_id: clientRefId, status: 'created', skip: skipRecord });
      } else {
        results.push({ client_ref_id: clientRefId, status: 'error', message: 'Unknown item kind' });
      }
    } catch (err) {
      results.push({ client_ref_id: clientRefId, status: 'error', message: err.message });
    }
  }

  res.json({ results });
});

const update = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('deliveries').select('*').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);

  const { quantity, unit_price, total_amount, payment_status, amount_paid, payment_mode, place, product_id, vehicle_id, notes } = req.body;

  if (product_id !== undefined) await assertProductVisible(req, product_id);
  if (vehicle_id) await assertVehicleVisible(req, vehicle_id);
  if (vehicle_id === null && isVehicleOrg(req)) throw ApiError.badRequest('A delivery must keep a vehicle');

  const amounts = resolveAmounts({
    quantity: quantity ?? existing.quantity,
    unit_price: unit_price ?? existing.unit_price_at_delivery,
    total_amount,
    payment_status: payment_status ?? existing.payment_status,
    amount_paid,
  });

  const patch = { ...amounts, edited_by: req.user.id };
  if (quantity !== undefined) patch.quantity = quantity;
  if (unit_price !== undefined) patch.unit_price_at_delivery = unit_price;
  if (payment_mode !== undefined) patch.payment_mode = payment_mode;
  if (place !== undefined) patch.place = place;
  if (product_id !== undefined) patch.product_id = product_id || null;
  if (vehicle_id !== undefined) patch.vehicle_id = vehicle_id || null;
  if (notes !== undefined) patch.notes = notes;
  if (payment_status !== undefined) patch.payment_status = payment_status;

  const delivery = unwrap(await supabase.from('deliveries').update(patch).eq('id', req.params.id).select(DELIVERY_SELECT).single());
  res.json(delivery);
});

const remove = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('deliveries').select('id, organization_id').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);
  unwrap(await supabase.from('deliveries').delete().eq('id', req.params.id).select('id').single());
  res.status(204).send();
});

// Staff home screen (the Daily Run Sheet): assigned/visible customers for
// today, in route order, each flagged with today's status so staff don't
// double-log and can see at a glance what's left.
const todayBoard = asyncHandler(async (req, res) => {
  const today = todayISODate();

  let customerQuery = supabase.from('customers').select('*').eq('organization_id', req.user.organizationId).eq('status', 'active');
  if (!req.organization.staff_sees_all_customers) {
    customerQuery = customerQuery.eq('assigned_staff_id', req.user.id);
  }
  // Route order first (nulls last, so un-sequenced customers fall to the end
  // rather than interleaving alphabetically with sequenced ones), then name.
  const customers = unwrap(await customerQuery
    .order('route_sequence', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true }));

  const [todaysDeliveries, todaysSkips] = await Promise.all([
    supabase.from('deliveries').select('*')
      .eq('organization_id', req.user.organizationId)
      .eq('staff_id', req.user.id)
      .eq('delivery_date', today).then(unwrap),
    supabase.from('route_skips').select('*')
      .eq('organization_id', req.user.organizationId)
      .eq('staff_id', req.user.id)
      .eq('skip_date', today).then(unwrap),
  ]);

  const deliveredByCustomerId = new Map(todaysDeliveries.map((d) => [d.customer_id, d]));
  const skippedByCustomerId = new Map(todaysSkips.map((s) => [s.customer_id, s]));

  res.json(customers.map((customer) => {
    const delivery = deliveredByCustomerId.get(customer.id) || null;
    const skip = skippedByCustomerId.get(customer.id) || null;
    return {
      customer,
      status: delivery ? 'delivered' : skip ? 'skipped' : 'pending',
      // Kept for any older client still reading this field.
      delivered_today: Boolean(delivery),
      todays_delivery: delivery,
      todays_skip: skip,
    };
  }));
});

const round2 = (n) => Math.round(n * 100) / 100;

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function summarize(deliveries) {
  const customers = new Set();
  const totals = deliveries.reduce((acc, d) => {
    const total = parseFloat(d.total_amount);
    const paid = parseFloat(d.amount_paid);
    acc.deliveries_count += 1;
    acc.value += total;
    acc.collected += paid;
    acc.pending_added += Math.max(total - paid, 0);
    customers.add(d.customer_id);
    return acc;
  }, { deliveries_count: 0, value: 0, collected: 0, pending_added: 0 });
  return {
    deliveries_count: totals.deliveries_count,
    customers_count: customers.size,
    value: round2(totals.value),
    collected: round2(totals.collected),
    pending_added: round2(totals.pending_added),
  };
}

function summarizePayments(payments) {
  return { count: payments.length, amount: round2(payments.reduce((sum, p) => sum + parseFloat(p.amount), 0)) };
}

// The signed-in staff member's own numbers: today / the last 7 days / this
// calendar month, a 7-day trend, how this month's deliveries split by payment
// status and how the money came in, and what they keyed in most recently
// (deliveries and, in a vehicle_eod org, payments). "Today" is the caller's own
// date (?today=YYYY-MM-DD) so a late-evening entry in a UTC+5:30 timezone counts
// for the day the person is actually in; it falls back to the server's UTC date.
const mySummary = asyncHandler(async (req, res) => {
  const requested = String(req.query.today || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested)) ? requested : todayISODate();
  const weekStart = addDays(today, -6);
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = weekStart < monthStart ? weekStart : monthStart;
  const orgId = req.user.organizationId;
  const me = req.user.id;

  const [deliveries, payments, recentDeliveries, recentPayments] = await Promise.all([
    supabase.from('deliveries')
      .select('customer_id, delivery_date, total_amount, amount_paid, payment_status, payment_mode')
      .eq('organization_id', orgId).eq('staff_id', me).gte('delivery_date', from).lte('delivery_date', today).then(unwrap),
    supabase.from('payments')
      .select('amount, payment_mode, payment_date')
      .eq('organization_id', orgId).eq('recorded_by', me).gte('payment_date', from).lte('payment_date', today).then(unwrap),
    supabase.from('deliveries')
      .select('id, delivery_date, total_amount, amount_paid, payment_status, payment_mode, created_at, customer:customers(id, name), vehicle:vehicles(id, vehicle_number)')
      .eq('organization_id', orgId).eq('staff_id', me).order('created_at', { ascending: false }).limit(10).then(unwrap),
    supabase.from('payments')
      .select('id, amount, payment_mode, payment_date, created_at, customer:customers(id, name), vehicle:vehicles(id, vehicle_number)')
      .eq('organization_id', orgId).eq('recorded_by', me).order('created_at', { ascending: false }).limit(10).then(unwrap),
  ]);

  const inWeek = (date) => date >= weekStart;
  const inMonth = (date) => date >= monthStart;

  const daily = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStart, i);
    daily.push({ date, ...summarize(deliveries.filter((d) => d.delivery_date === date)) });
  }

  const monthDeliveries = deliveries.filter((d) => inMonth(d.delivery_date));
  const monthPayments = payments.filter((p) => inMonth(p.payment_date));

  const byStatus = { paid: 0, partial: 0, pending: 0 };
  const modeTotals = new Map();
  const addToMode = (mode, amount) => {
    if (!(amount > 0)) return;
    const key = mode || 'other';
    modeTotals.set(key, (modeTotals.get(key) || 0) + amount);
  };
  for (const d of monthDeliveries) {
    if (byStatus[d.payment_status] !== undefined) byStatus[d.payment_status] += 1;
    addToMode(d.payment_mode, parseFloat(d.amount_paid));
  }
  for (const p of monthPayments) addToMode(p.payment_mode, parseFloat(p.amount));

  const activity = [
    ...recentDeliveries.map((d) => ({
      type: 'delivery', id: d.id, at: d.created_at, date: d.delivery_date, customer: d.customer, vehicle: d.vehicle,
      amount: parseFloat(d.total_amount), paid: parseFloat(d.amount_paid), payment_status: d.payment_status, payment_mode: d.payment_mode,
    })),
    ...recentPayments.map((p) => ({
      type: 'payment', id: p.id, at: p.created_at, date: p.payment_date, customer: p.customer, vehicle: p.vehicle,
      amount: parseFloat(p.amount), paid: parseFloat(p.amount), payment_status: null, payment_mode: p.payment_mode,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);

  res.json({
    today: summarize(deliveries.filter((d) => d.delivery_date === today)),
    this_week: summarize(deliveries.filter((d) => inWeek(d.delivery_date))),
    this_month: summarize(monthDeliveries),
    payments_recorded: {
      today: summarizePayments(payments.filter((p) => p.payment_date === today)),
      this_week: summarizePayments(payments.filter((p) => inWeek(p.payment_date))),
      this_month: summarizePayments(monthPayments),
    },
    daily,
    month_by_status: byStatus,
    month_collected_by_mode: [...modeTotals.entries()].map(([mode, amount]) => ({ mode, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    recent_activity: activity,
  });
});

module.exports = { list, create, update, remove, todayBoard, mySummary, skip, syncBatch, recentPlaces, dismissPlace, vehicleEodBatch };
