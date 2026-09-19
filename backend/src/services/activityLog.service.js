const supabase = require('../config/supabaseClient');

// Append-only log of logins and server errors, powering Super Admin's
// DAU/MAU, error-rate, and onboarding-funnel views (see
// superAdmin.controller.js). Same "never block the caller" shape as
// auditLog.service.js's recordAudit, but a distinct table: this is raw
// traffic/login/error events, not explicit business actions.
async function recordActivity({ organizationId = null, userId = null, eventType, metadata = null }) {
  const { error } = await supabase.from('activity_events').insert({
    organization_id: organizationId,
    user_id: userId,
    event_type: eventType,
    metadata,
  });
  if (error) {
    console.error('Failed to write activity event:', eventType, error.message);
  }
}

// Records a login event AND (best-effort) flags it as a "new device" for the
// Org Admin dashboard's notification widget — see dashboard.controller.js's
// recent_new_device_logins. Must check for a prior same-device login BEFORE
// writing this one's own event, or the just-written row would always match
// itself and no device would ever look "new". Only fires the flag when the
// user has logged in before at all — a person's very first login is not a
// "new device", it's just the first one.
//
// This is intentionally coarse: a User-Agent string is a weak fingerprint
// (identical across many phones of the same model/browser version, and
// changes on a routine browser update), so this is an informational
// heads-up for the org admin, never a real security control.
async function recordLoginActivity({ organizationId, userId, deviceHash, userAgent }) {
  try {
    const [{ count: priorLoginCount }, { data: sameDeviceLogins, error: sameDeviceError }] = await Promise.all([
      supabase.from('activity_events').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('event_type', 'login'),
      supabase.from('activity_events').select('id').eq('user_id', userId).eq('event_type', 'login').eq('metadata->>device_hash', deviceHash).limit(1),
    ]);
    if (sameDeviceError) throw sameDeviceError;

    await recordActivity({ organizationId, userId, eventType: 'login', metadata: { device_hash: deviceHash } });

    if ((priorLoginCount || 0) > 0 && sameDeviceLogins.length === 0) {
      await recordActivity({ organizationId, userId, eventType: 'new_device_login', metadata: { user_agent: userAgent } });
    }
  } catch (err) {
    console.error('Failed to record login activity:', err.message);
  }
}

module.exports = { recordActivity, recordLoginActivity };
