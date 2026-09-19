const app = require('./src/app');
const env = require('./src/config/env');
const supabase = require('./src/config/supabaseClient');

async function start() {
  const { error } = await supabase.from('organizations').select('id').limit(1);
  if (error) {
    console.error('Unable to reach Supabase:', error.message);
    console.error('Did you run backend/supabase/schema.sql in the Supabase SQL Editor yet?');
    process.exit(1);
  }
  console.log('Supabase connection OK.');

  app.listen(env.port, () => {
    console.log(`Delyver API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
