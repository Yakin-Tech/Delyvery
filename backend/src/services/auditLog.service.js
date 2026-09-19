const supabase = require('../config/supabaseClient');

// Best-effort audit trail for Super Admin actions (org create/status/admin
// management/impersonation). Never blocks the calling request on failure —
// an audit-log write hiccup shouldn't stop a real operation from succeeding.
async function recordAudit({ organizationId = null, userId, action, metadata = null }) {
  const { error } = await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action,
    metadata,
  });
  if (error) {
    console.error('Failed to write audit log:', action, error.message);
  }
}

module.exports = { recordAudit };
