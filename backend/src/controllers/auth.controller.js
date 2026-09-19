const crypto = require('crypto');
const supabase = require('../config/supabaseClient');
const { comparePassword, hashPassword, signToken } = require('../services/auth.service');
const { recordActivity, recordLoginActivity } = require('../services/activityLog.service');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { VALID_LANGUAGES } = require('../utils/languages');

async function loadOrganization(organizationId) {
  if (!organizationId) return null;
  return unwrap(await supabase.from('organizations').select('*').eq('id', organizationId).maybeSingle());
}

function serializeUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    organization_id: user.organization_id,
    preferred_language: user.preferred_language,
    theme_mode: user.theme_mode,
    assigned_zone: user.assigned_zone,
  };
}

const login = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  const user = unwrap(await supabase.from('users').select('*').eq('phone', phone).maybeSingle());
  if (!user || user.status !== 'active') {
    throw ApiError.unauthorized('Invalid phone or password');
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid phone or password');
  }

  const organization = await loadOrganization(user.organization_id);
  if (user.organization_id && (!organization || ['suspended', 'expired'].includes(organization.status))) {
    throw ApiError.forbidden('Your organization account is not active. Contact support.');
  }

  const token = signToken({ id: user.id, role: user.role, organizationId: user.organization_id });

  // Fire-and-forget: powers Super Admin's DAU/MAU (see superAdmin.controller.js
  // stats/activity) and the Org Admin "new device" alert (see
  // activityLog.service.js) without making login latency depend on either.
  const userAgent = req.headers['user-agent'] || '';
  const deviceHash = crypto.createHash('sha1').update(userAgent).digest('hex').slice(0, 16);
  recordLoginActivity({ organizationId: user.organization_id, userId: user.id, deviceHash, userAgent });

  res.json({ token, user: serializeUser(user), organization, impersonated_by: null });
});

const me = asyncHandler(async (req, res) => {
  const user = unwrap(await supabase.from('users').select('*').eq('id', req.user.id).maybeSingle());
  if (!user) throw ApiError.notFound('User not found');

  const organization = await loadOrganization(user.organization_id);

  res.json({ user: serializeUser(user), organization, impersonated_by: req.impersonatedBy || null });
});

const VALID_THEME_MODES = ['light', 'dark'];

// Self-service: any authenticated user (any role) can change their own display
// name, display language and/or theme preferences. Whichever fields are present
// get validated and patched; sticks for that user everywhere (any device) until
// they change it again, same as preferred_language.
const updateMe = asyncHandler(async (req, res) => {
  const { name, preferred_language, theme_mode } = req.body;
  const patch = {};

  if (name !== undefined) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 2 || trimmed.length > 100) {
      throw ApiError.badRequest('name must be between 2 and 100 characters');
    }
    patch.name = trimmed;
  }

  if (preferred_language !== undefined) {
    if (!VALID_LANGUAGES.includes(preferred_language)) {
      throw ApiError.badRequest(`preferred_language must be one of: ${VALID_LANGUAGES.join(', ')}`);
    }
    patch.preferred_language = preferred_language;
  }
  if (theme_mode !== undefined) {
    if (!VALID_THEME_MODES.includes(theme_mode)) {
      throw ApiError.badRequest(`theme_mode must be one of: ${VALID_THEME_MODES.join(', ')}`);
    }
    patch.theme_mode = theme_mode;
  }
  if (Object.keys(patch).length === 0) {
    throw ApiError.badRequest('No valid fields to update');
  }

  const user = unwrap(await supabase.from('users').update(patch).eq('id', req.user.id).select('*').single());
  res.json({ user: serializeUser(user) });
});

// Self-service password change for any role: unlike staff.controller.js's
// resetPassword (an org admin resetting someone else's, no old password
// needed) or the super-admin equivalent, this always requires the caller's
// current password — it's the "I know my password but want to change it"
// path, not the "I forgot it, someone else reset it for me" path.
const changePassword = asyncHandler(async (req, res) => {
  const { old_password, new_password } = req.body;

  const user = unwrap(await supabase.from('users').select('id, password_hash').eq('id', req.user.id).maybeSingle());
  if (!user) throw ApiError.notFound('User not found');

  const valid = await comparePassword(old_password, user.password_hash);
  if (!valid) throw ApiError.unauthorized('Current password is incorrect');

  const password_hash = await hashPassword(new_password);
  unwrap(await supabase.from('users').update({ password_hash }).eq('id', req.user.id).select('id').single());

  res.json({ success: true });
});

module.exports = { login, me, updateMe, changePassword, serializeUser };
