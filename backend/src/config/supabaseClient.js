const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

// Single shared client using the service_role ("secret") key. This talks to
// Postgres through Supabase's PostgREST API over HTTPS, which sidesteps needing
// a raw TCP connection to the database (the direct host is IPv6-only).
const supabase = createClient(env.supabase.url, env.supabase.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
});

module.exports = supabase;
