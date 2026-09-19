// One-off bootstrap script (run manually, not a migration) that creates the very
// first Super Admin, plus one demo Organization + Org Admin so there is something
// to log into before the Super Admin panel exists.
//
// Run backend/supabase/schema.sql in the Supabase SQL Editor FIRST, then:
//   npm run db:seed

const supabase = require('../src/config/supabaseClient');
const { hashPassword } = require('../src/services/auth.service');
const env = require('../src/config/env');

async function run() {
  const { superAdmin, org } = env.seed;
  if (!superAdmin.phone || !superAdmin.password || !org.adminPhone || !org.adminPassword) {
    console.error('Seed env vars are missing. Check SEED_* values in backend/.env');
    process.exit(1);
  }

  let { data: admin, error: adminLookupError } = await supabase
    .from('users').select('*').eq('phone', superAdmin.phone).maybeSingle();
  if (adminLookupError) throw adminLookupError;

  if (!admin) {
    const { data, error } = await supabase.from('users').insert({
      organization_id: null,
      role: 'super_admin',
      name: superAdmin.name,
      phone: superAdmin.phone,
      password_hash: await hashPassword(superAdmin.password),
    }).select('*').single();
    if (error) throw error;
    admin = data;
    console.log(`Created Super Admin: ${superAdmin.phone}`);
  } else {
    console.log('Super Admin already exists, skipping.');
  }

  let { data: organization, error: orgLookupError } = await supabase
    .from('organizations').select('*').eq('name', org.name).maybeSingle();
  if (orgLookupError) throw orgLookupError;

  if (!organization) {
    const { data, error } = await supabase.from('organizations').insert({
      name: org.name,
      business_type: 'water',
      unit_of_measure: 'can',
      default_language: 'en',
      phone_numbers: [org.adminPhone],
      default_price_per_unit: 30,
      status: 'active',
      staff_sees_all_customers: true,
      staff_can_add_customers: false,
      created_by: admin.id,
    }).select('*').single();
    if (error) throw error;
    organization = data;
    console.log(`Created Organization: ${org.name}`);
  } else {
    console.log('Demo organization already exists, skipping.');
  }

  const { data: orgAdmin, error: orgAdminLookupError } = await supabase
    .from('users').select('id').eq('phone', org.adminPhone).maybeSingle();
  if (orgAdminLookupError) throw orgAdminLookupError;

  if (!orgAdmin) {
    const { error } = await supabase.from('users').insert({
      organization_id: organization.id,
      role: 'org_admin',
      name: org.adminName,
      phone: org.adminPhone,
      password_hash: await hashPassword(org.adminPassword),
      created_by: admin.id,
    });
    if (error) throw error;
    console.log(`Created Org Admin: ${org.adminPhone}`);
  } else {
    console.log('Org Admin already exists, skipping.');
  }

  console.log('\nSeed complete. Login credentials:');
  console.log(`  Super Admin -> phone: ${superAdmin.phone}, password: ${superAdmin.password}`);
  console.log(`  Org Admin   -> phone: ${org.adminPhone}, password: ${org.adminPassword}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
