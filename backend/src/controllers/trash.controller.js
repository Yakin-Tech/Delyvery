const crypto = require('crypto');
const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const { hashPassword } = require('../services/auth.service');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { parsePagination } = require('../utils/paginate');

// Recycle bin for the four org-admin-managed entities that can be moved to
// Trash (vehicle.controller.js / staff.controller.js / customer.controller.js
// / product.controller.js 'remove' — a soft delete setting deleted_at/
// deleted_by, always allowed). This controller is what lets an org admin see
// everything that's in Trash across all four, restore one, permanently
// delete it (blocked if anything still references it), or — once blocked —
// resolve it for good with one of two explicit choices: anonymize (keep the
// history, strip this record's identity) or force-delete (destroy the
// history too). See anonymize/forceDelete below.
//
// guards: [table, column] pairs checked before a permanent delete; if any
// has a matching row, the record stays in Trash instead of being destroyed,
// so real delivery/payment/ledger history is never silently lost by the
// plain "Delete permanently" action. Mirrors the checks each entity's old
// hard-delete used to run inline.
const TRASH_TYPES = {
  vehicle: {
    table: 'vehicles',
    nameField: 'vehicle_number',
    subtitleField: 'driver_name',
    guards: [['deliveries', 'vehicle_id'], ['payments', 'vehicle_id'], ['customers', 'assigned_vehicle_id']],
    inUseMessage: 'This vehicle still has delivery or payment history and cannot be permanently deleted.',
    anonymize: () => ({ vehicle_number: 'Deleted Vehicle', label: null, driver_name: null, driver_phone: null, notes: null }),
  },
  staff: {
    table: 'users',
    nameField: 'name',
    subtitleField: 'phone',
    extraFilter: (q) => q.eq('role', 'staff'),
    // Every one of these has no on-delete clause in schema.sql, so a plain
    // delete on a staff member any of them references would fail at the DB
    // level — not just the not-null ones; a nullable column with no
    // on-delete still blocks, it just means the value COULD be cleared, not
    // that Postgres clears it automatically. All of them need to be listed
    // here so the guarded path below always either succeeds or cleanly
    // 409s, and never crashes into a raw DB error. force_delete_staff in
    // schema.sql is what actually clears/deletes all of these when the
    // admin picks "delete everything" instead.
    guards: [
      ['deliveries', 'staff_id'],
      ['payments', 'recorded_by'],
      ['credit_notes', 'issued_by'],
      ['credit_notes', 'voided_by'],
      ['route_skips', 'staff_id'],
      ['customer_deposits', 'created_by'],
      ['stock_movements', 'recorded_by'],
      ['place_dismissals', 'dismissed_by'],
      ['customers', 'assigned_staff_id'],
    ],
    inUseMessage: 'This staff member still has delivery or payment history and cannot be permanently deleted.',
    // phone keeps the users.phone not-null constraint satisfied without
    // colliding with anyone else's (the partial unique index only applies
    // to non-deleted users anyway, but a readable non-login-able value is
    // nicer than leaving their real number). password_hash is scrambled as
    // belt-and-suspenders — deleted_at already blocks login on its own (see
    // middleware/auth.js), this just makes sure no password could ever work.
    anonymize: async (existing) => ({
      name: 'Deleted Staff',
      phone: `deleted-${existing.id}`,
      assigned_zone: null,
      password_hash: await hashPassword(crypto.randomUUID()),
    }),
  },
  customer: {
    table: 'customers',
    nameField: 'name',
    subtitleField: 'phone',
    guards: [['deliveries', 'customer_id'], ['payments', 'customer_id'], ['credit_notes', 'customer_id'], ['customer_deposits', 'customer_id'], ['route_skips', 'customer_id']],
    inUseMessage: 'This customer still has delivery or payment history and cannot be permanently deleted.',
    anonymize: () => ({ name: 'Deleted Customer', phone: null, alternate_phone: null, address: null, notes: null }),
  },
  product: {
    table: 'products',
    nameField: 'name',
    subtitleField: 'unit_of_measure',
    guards: [['deliveries', 'product_id'], ['stock_movements', 'product_id']],
    inUseMessage: 'This product still has delivery or stock history and cannot be permanently deleted.',
    anonymize: () => ({ name: 'Deleted Product' }),
  },
};

function requireType(type) {
  const config = TRASH_TYPES[type];
  if (!config) throw ApiError.badRequest('Invalid trash type');
  return config;
}

async function hasRows(table, column, id) {
  const { data, error } = await supabase.from(table).select('id').eq(column, id).limit(1);
  if (error) throw new ApiError(500, error.message);
  return data.length > 0;
}

// Each fetched row is normalised to the same { id, type, name, subtitle,
// deleted_at, deleted_by } shape, so the frontend's single Trash table can
// render all four entity types without caring which table a row came from.
// Anonymized rows (see anonymize below) are excluded — they're a resolved,
// permanent tombstone with nothing left to restore or delete, so there's
// nothing left for the Trash page to do with them.
const FETCH_LIMIT = 200;

async function fetchTrashed(type, config, orgId) {
  let query = supabase
    .from(config.table)
    .select(`id, ${config.nameField}, ${config.subtitleField}, deleted_at, deleted_by_user:users!deleted_by(id, name)`)
    .eq('organization_id', orgId)
    .not('deleted_at', 'is', null)
    .is('anonymized_at', null);
  if (config.extraFilter) query = config.extraFilter(query);

  const rows = unwrap(await query.order('deleted_at', { ascending: false }).limit(FETCH_LIMIT));
  return rows.map((r) => ({
    id: r.id,
    type,
    name: r[config.nameField],
    subtitle: r[config.subtitleField] || null,
    deleted_at: r.deleted_at,
    deleted_by: r.deleted_by_user || null,
  }));
}

const list = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req);
  const pg = parsePagination(req.query);
  const { type } = req.query;

  const types = type ? [type] : Object.keys(TRASH_TYPES);
  types.forEach(requireType);

  const results = await Promise.all(types.map((t) => fetchTrashed(t, TRASH_TYPES[t], orgId)));
  const merged = results.flat().sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  const page = merged.slice(pg.from, pg.to + 1);

  res.json(pg.buildResult(page, merged.length));
});

async function loadTrashedRecord(req, config) {
  let query = supabase.from(config.table).select('id, organization_id, deleted_at, anonymized_at').eq('id', req.params.id);
  if (config.extraFilter) query = config.extraFilter(query);
  const existing = unwrap(await query.maybeSingle());
  assertSameOrg(req, existing);
  if (!existing.deleted_at || existing.anonymized_at) throw ApiError.badRequest('This item is not in Trash');
  return existing;
}

const restore = asyncHandler(async (req, res) => {
  const config = requireType(req.params.type);
  const existing = await loadTrashedRecord(req, config);

  unwrap(await supabase.from(config.table).update({ deleted_at: null, deleted_by: null }).eq('id', existing.id));
  res.json({ success: true });
});

// The default, safe permanent-delete: blocked (409, config.inUseMessage)
// whenever anything still references this record — the Trash page then
// offers anonymize/forceDelete below as the explicit way to resolve that.
const permanentDelete = asyncHandler(async (req, res) => {
  const config = requireType(req.params.type);
  const existing = await loadTrashedRecord(req, config);

  const referenced = await Promise.all(config.guards.map(([table, column]) => hasRows(table, column, existing.id)));
  if (referenced.some(Boolean)) {
    throw ApiError.conflict(config.inUseMessage);
  }

  unwrap(await supabase.from(config.table).delete().eq('id', existing.id));
  res.json({ success: true });
});

// "Keep history, remove details": overwrites this record's own identifying
// fields with a generic "Deleted <type>" placeholder and marks it resolved
// (anonymized_at) instead of actually deleting it, so every delivery/payment/
// etc. that still references it keeps resolving to a real row — just one
// that no longer carries this person's/vehicle's real name, phone, etc.
// Never blocked: that's the point of this option over permanentDelete.
const anonymize = asyncHandler(async (req, res) => {
  const config = requireType(req.params.type);
  const existing = await loadTrashedRecord(req, config);

  const patch = await config.anonymize(existing);
  unwrap(await supabase.from(config.table).update({ ...patch, anonymized_at: new Date().toISOString() }).eq('id', existing.id));
  res.json({ success: true });
});

// "Delete everything permanently": the explicit, destructive counterpart to
// anonymize — actually deletes the record and (for staff) the history that
// was blocking it. For vehicle/customer/product every remaining reference in
// schema.sql is on-delete-cascade or on-delete-set-null, so a plain delete
// already does the right thing in one atomic statement; staff is the one
// case with several not-null, no-on-delete-clause references (deliveries,
// payments, credit notes, route skips, price history), so freeing them needs
// several coordinated deletes/updates — see force_delete_staff in schema.sql,
// run as one function so a failure partway through can't leave this half-done.
const forceDelete = asyncHandler(async (req, res) => {
  const config = requireType(req.params.type);
  const existing = await loadTrashedRecord(req, config);

  if (req.params.type === 'staff') {
    unwrap(await supabase.rpc('force_delete_staff', { p_staff_id: existing.id, p_organization_id: existing.organization_id }));
  } else {
    unwrap(await supabase.from(config.table).delete().eq('id', existing.id));
  }
  res.json({ success: true });
});

module.exports = { list, restore, permanentDelete, anonymize, forceDelete };
