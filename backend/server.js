const app = require('./src/app');
const env = require('./src/config/env');
const supabase = require('./src/config/supabaseClient');

// postgrest-js resolves (never rejects) this call, with `status` telling you
// *where* it failed: 0 means the fetch itself never got a response (DNS/
// network), 5xx with a non-JSON `error.message` means Cloudflare/the platform
// answered instead of Postgrest (almost always a paused project), and a real
// Postgrest error (status 401/404 with a `code`) means Supabase answered but
// rejected the request — only that last case is actually about schema.sql.
const PROJECT_REF = (env.supabase.url.match(/^https:\/\/([^.]+)\.supabase\.co/) || [])[1];
const DASHBOARD_HINT = PROJECT_REF
  ? `Check it at https://supabase.com/dashboard/project/${PROJECT_REF}`
  : 'Check your project in the Supabase dashboard';

function describeSupabaseFailure(error, status) {
  const message = (error.message || '').slice(0, 300);

  if (status === 0) {
    return [
      `Could not reach ${env.supabase.url} at all: ${message}`,
      'Check your internet connection, and that SUPABASE_URL in backend/.env matches your Supabase project.',
    ];
  }
  if (status >= 500) {
    return [
      `Supabase returned HTTP ${status} instead of a response from your database — that's Cloudflare/the platform, not Postgres.`,
      `This almost always means the project is paused. ${DASHBOARD_HINT} and resume it, then retry.`,
    ];
  }
  if (status === 401 || status === 403) {
    return [
      `Supabase rejected the request (HTTP ${status}): ${message}`,
      'Check that SUPABASE_SECRET_KEY in backend/.env matches the service_role/secret key in Settings -> API.',
    ];
  }
  if (error.code === '42P01' || /relation .* does not exist/i.test(message)) {
    return [
      `Supabase is reachable, but the "organizations" table doesn't exist yet: ${message}`,
      'Run backend/supabase/schema.sql in the Supabase SQL Editor, then retry.',
    ];
  }
  return [
    `Unable to reach Supabase (HTTP ${status}): ${message}`,
    'Check backend/supabase/schema.sql has been run, and that SUPABASE_URL / SUPABASE_SECRET_KEY in backend/.env are correct.',
  ];
}

async function start() {
  const { error, status } = await supabase.from('organizations').select('id').limit(1);
  if (error) {
    for (const line of describeSupabaseFailure(error, status)) console.error(line);
    process.exit(1);
  }
  console.log('Supabase connection OK.');

  app.listen(env.port, () => {
    console.log(`Delyver API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
