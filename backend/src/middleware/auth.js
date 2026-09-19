const { verifyToken } = require('../services/auth.service');
const supabase = require('../config/supabaseClient');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Verifies the JWT and attaches req.user = { id, role, organization_id, name, phone }.
// Also attaches req.organization for org_admin/staff so controllers can read org-level
// settings (staff_sees_all_customers, unit, default price) without a fresh query each time.
// Re-fetches the user on every request (rather than trusting the token payload alone)
// so a deactivated user is rejected immediately instead of waiting for token expiry.
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, organization_id, role, name, phone, status')
    .eq('id', payload.sub)
    .maybeSingle();

  if (error) throw new ApiError(500, error.message);
  if (!user || user.status !== 'active') {
    throw ApiError.unauthorized('Account not found or inactive');
  }

  req.user = {
    id: user.id,
    role: user.role,
    organizationId: user.organization_id,
    name: user.name,
    phone: user.phone,
  };
  req.impersonatedBy = payload.impersonatedBy || null;

  if (user.organization_id) {
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', user.organization_id)
      .maybeSingle();

    if (orgError) throw new ApiError(500, orgError.message);
    if (!organization || ['suspended', 'expired'].includes(organization.status)) {
      throw ApiError.forbidden('Your organization account is not active. Contact support.');
    }
    req.organization = organization;
  }

  next();
});

module.exports = authenticate;
