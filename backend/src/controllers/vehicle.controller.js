const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { unwrapPage } = unwrap;
const { parsePagination } = require('../utils/paginate');
const sanitizeSearchTerm = require('../utils/sanitizeSearchTerm');

const VEHICLE_FIELDS = 'id, organization_id, vehicle_number, label, driver_name, driver_phone, status, notes, created_by, created_at, updated_at';

// "ka 01 ab-1234" and "KA01AB1234" are the same vehicle — normalising before
// every write is what lets the (organization_id, vehicle_number) unique index
// in schema.sql actually catch duplicates typed differently.
function normalizeVehicleNumber(value) {
  return String(value).toUpperCase().replace(/[\s-]+/g, '');
}

const list = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);
  const { status, search } = req.query;

  let query = supabase
    .from('vehicles')
    .select(VEHICLE_FIELDS, { count: 'exact' })
    .eq('organization_id', requireOrgId(req))
    .is('deleted_at', null);

  if (status) query = query.eq('status', status);
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term) query = query.or(`vehicle_number.ilike.%${term}%,driver_name.ilike.%${term}%`);
  }

  const { data, count } = unwrapPage(await query
    .order('vehicle_number', { ascending: true })
    .range(pg.from, pg.to));

  res.json(pg.buildResult(data, count));
});

// Only checks among non-deleted vehicles — a trashed vehicle's number is
// free to reuse (see the partial unique index in schema.sql).
async function assertVehicleNumberFree(orgId, vehicleNumber, exceptId) {
  let query = supabase.from('vehicles').select('id').eq('organization_id', orgId).eq('vehicle_number', vehicleNumber).is('deleted_at', null);
  if (exceptId) query = query.neq('id', exceptId);
  const existing = unwrap(await query.maybeSingle());
  if (existing) throw ApiError.conflict('A vehicle with this number already exists');
}

const create = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req);
  const { vehicle_number, label, driver_name, driver_phone, notes } = req.body;
  const normalizedNumber = normalizeVehicleNumber(vehicle_number);

  await assertVehicleNumberFree(orgId, normalizedNumber);

  const vehicle = unwrap(await supabase.from('vehicles').insert({
    organization_id: orgId,
    vehicle_number: normalizedNumber,
    label: label || null,
    driver_name: driver_name || null,
    driver_phone: driver_phone || null,
    notes: notes || null,
    created_by: req.user.id,
  }).select(VEHICLE_FIELDS).single());

  res.status(201).json(vehicle);
});

const update = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('vehicles').select('id, organization_id').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  assertSameOrg(req, existing);

  const { vehicle_number, label, driver_name, driver_phone, notes, status } = req.body;
  const patch = {};
  if (vehicle_number !== undefined) {
    patch.vehicle_number = normalizeVehicleNumber(vehicle_number);
    await assertVehicleNumberFree(existing.organization_id, patch.vehicle_number, existing.id);
  }
  if (label !== undefined) patch.label = label || null;
  if (driver_name !== undefined) patch.driver_name = driver_name || null;
  if (driver_phone !== undefined) patch.driver_phone = driver_phone || null;
  if (notes !== undefined) patch.notes = notes || null;
  if (status !== undefined) patch.status = status;

  if (Object.keys(patch).length === 0) throw ApiError.badRequest('No fields provided');

  const vehicle = unwrap(await supabase.from('vehicles').update(patch).eq('id', req.params.id).select(VEHICLE_FIELDS).single());
  res.json(vehicle);
});

// Moves a vehicle to Trash (see trash.controller.js) instead of deleting it
// outright — status 'inactive' is still how a vehicle still in use elsewhere
// gets retired day-to-day; this is for removing one from the list entirely,
// reversibly, and always succeeds — any customers still assigned to it, or
// delivery/payment history, get resolved from the Trash page instead (its
// guarded permanent-delete, with "delete everything" / "keep history, remove
// details" follow-ups). A customer still pointing at a Trashed vehicle can't
// be silently misused in the meantime — resolveVehicleId in
// delivery.controller.js never auto-attaches a deleted vehicle to a new
// delivery.
const remove = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('vehicles').select('id, organization_id').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  assertSameOrg(req, existing);

  unwrap(await supabase.from('vehicles').update({ deleted_at: new Date().toISOString(), deleted_by: req.user.id }).eq('id', existing.id));
  res.json({ success: true });
});

module.exports = { list, create, update, remove };
