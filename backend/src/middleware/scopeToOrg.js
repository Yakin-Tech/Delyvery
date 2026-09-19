const ApiError = require('../utils/ApiError');

// Every org_admin/staff route must scope its queries through this helper instead
// of trusting any organization_id a client might send in the body/query string.
// Super admin routes (a later phase) never call this.
function requireOrgId(req) {
  if (!req.user || !req.user.organizationId) {
    throw ApiError.forbidden('No organization context for this account');
  }
  return req.user.organizationId;
}

// Throws 404 (not 403) if a fetched record belongs to a different org, so a
// cross-tenant id lookup behaves identically to a nonexistent id.
function assertSameOrg(req, record) {
  if (!record || record.organization_id !== req.user.organizationId) {
    throw ApiError.notFound('Resource not found');
  }
}

module.exports = { requireOrgId, assertSameOrg };
