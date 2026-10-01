const supabase = require('../config/supabaseClient');
const { hashPassword } = require('../services/auth.service');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { unwrapPage } = unwrap;
const { parsePagination } = require('../utils/paginate');

const STAFF_FIELDS = 'id, organization_id, role, name, phone, preferred_language, status, assigned_zone, created_by, created_at, updated_at';

const list = asyncHandler(async (req, res) => {
  const pg = parsePagination(req.query);

  const { data, count } = unwrapPage(await supabase
    .from('users')
    .select(STAFF_FIELDS, { count: 'exact' })
    .eq('organization_id', requireOrgId(req))
    .eq('role', 'staff')
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .range(pg.from, pg.to));

  res.json(pg.buildResult(data, count));
});

const create = asyncHandler(async (req, res) => {
  const { name, phone, password, assigned_zone, preferred_language } = req.body;

  // Only among non-deleted users — phone is free to reuse once its previous
  // owner has been moved to Trash (see the partial unique index in schema.sql).
  const existing = unwrap(await supabase.from('users').select('id').eq('phone', phone).is('deleted_at', null).maybeSingle());
  if (existing) throw ApiError.conflict('A user with this phone number already exists');

  const password_hash = await hashPassword(password);
  const staff = unwrap(await supabase.from('users').insert({
    organization_id: req.user.organizationId,
    role: 'staff',
    name,
    phone,
    password_hash,
    assigned_zone: assigned_zone || null,
    preferred_language: preferred_language || 'en',
    created_by: req.user.id,
  }).select(STAFF_FIELDS).single());

  res.status(201).json(staff);
});

const update = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  assertSameOrg(req, existing);
  if (existing.role !== 'staff') throw ApiError.notFound('Staff member not found');

  const { name, assigned_zone, preferred_language, status } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (assigned_zone !== undefined) patch.assigned_zone = assigned_zone;
  if (preferred_language !== undefined) patch.preferred_language = preferred_language;
  if (status !== undefined) patch.status = status;

  const staff = unwrap(await supabase.from('users').update(patch).eq('id', req.params.id).select(STAFF_FIELDS).single());
  res.json(staff);
});

// Moves a staff member to Trash (see trash.controller.js) instead of deleting
// them outright — status 'inactive' is still how a staff member is normally
// taken off active duty day-to-day; this is for removing one from the list
// entirely, reversibly, and always succeeds — any customers still assigned
// to them, or delivery/payment history, get resolved from the Trash page
// instead (its guarded permanent-delete, with "delete everything" / "keep
// history, remove details" follow-ups). A Trashed staff member can no longer
// log in (see middleware/auth.js and auth.controller.js), so they can't act
// on anything still pointing at them in the meantime.
const remove = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  assertSameOrg(req, existing);
  if (existing.role !== 'staff') throw ApiError.notFound('Staff member not found');

  unwrap(await supabase.from('users').update({ deleted_at: new Date().toISOString(), deleted_by: req.user.id }).eq('id', existing.id));
  res.json({ success: true });
});

const resetPassword = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', req.params.id).is('deleted_at', null).maybeSingle());
  assertSameOrg(req, existing);
  if (existing.role !== 'staff') throw ApiError.notFound('Staff member not found');

  const password_hash = await hashPassword(req.body.password);
  unwrap(await supabase.from('users').update({ password_hash }).eq('id', req.params.id).select('id').single());

  res.json({ success: true });
});

module.exports = { list, create, update, remove, resetPassword };
