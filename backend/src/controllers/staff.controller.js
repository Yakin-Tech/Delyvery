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
    .order('name', { ascending: true })
    .range(pg.from, pg.to));

  res.json(pg.buildResult(data, count));
});

const create = asyncHandler(async (req, res) => {
  const { name, phone, password, assigned_zone, preferred_language } = req.body;

  const existing = unwrap(await supabase.from('users').select('id').eq('phone', phone).maybeSingle());
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
  const existing = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', req.params.id).maybeSingle());
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

const resetPassword = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('users').select('id, organization_id, role').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);
  if (existing.role !== 'staff') throw ApiError.notFound('Staff member not found');

  const password_hash = await hashPassword(req.body.password);
  unwrap(await supabase.from('users').update({ password_hash }).eq('id', req.params.id).select('id').single());

  res.json({ success: true });
});

module.exports = { list, create, update, resetPassword };
