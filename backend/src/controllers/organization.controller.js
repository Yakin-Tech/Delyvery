const supabase = require('../config/supabaseClient');
const { requireOrgId } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');

// name/business_type/status are Super-Admin-owned identity fields — org_admin
// can see them but only these operational fields are editable here.
const EDITABLE_FIELDS = [
  'unit_of_measure',
  'default_price_per_unit',
  'address',
  'phone_numbers',
  'delivery_modes',
  'logo_url',
  'staff_sees_all_customers',
  'staff_can_add_customers',
  'payment_allocation_mode',
  'products_enabled',
  'routes_enabled',
  'stock_enabled',
];

const getOwnOrganization = asyncHandler(async (req, res) => {
  const organization = unwrap(await supabase.from('organizations').select('*').eq('id', requireOrgId(req)).single());
  res.json(organization);
});

const updateOwnOrganization = asyncHandler(async (req, res) => {
  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) patch[field] = req.body[field];
  }
  if (Object.keys(patch).length === 0) {
    throw ApiError.badRequest('No editable fields provided');
  }

  const organization = unwrap(await supabase.from('organizations').update(patch).eq('id', requireOrgId(req)).select('*').single());
  res.json(organization);
});

// Persists first-login setup-wizard progress so it resumes on the same step
// across logins/devices instead of restarting (see the onboarding_step/
// onboarding_completed_at comment in schema.sql). "Skip for now" on any step
// calls this with completed: true.
const updateOnboarding = asyncHandler(async (req, res) => {
  const { step, completed } = req.body;
  const patch = {};
  if (step !== undefined) patch.onboarding_step = step;
  if (completed) patch.onboarding_completed_at = new Date().toISOString();

  if (Object.keys(patch).length === 0) {
    throw ApiError.badRequest('No onboarding fields provided');
  }

  const organization = unwrap(await supabase.from('organizations').update(patch).eq('id', requireOrgId(req)).select('*').single());
  res.json(organization);
});

module.exports = { getOwnOrganization, updateOwnOrganization, updateOnboarding };
