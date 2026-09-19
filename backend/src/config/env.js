require('dotenv').config();

const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'JWT_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  // Comma-separated in .env so more than one local dev frontend (e.g. the
  // user's own `npm start` plus an automated browser tool on a different
  // port) can hit this API at once without editing .env back and forth.
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((o) => o.trim()),

  supabase: {
    url: process.env.SUPABASE_URL,
    // Service role ("secret") key — full DB access, bypassing Row Level Security.
    // Used only on the backend; the org/role scoping is enforced in our own
    // Express middleware and controllers, never by trusting the client.
    serviceKey: process.env.SUPABASE_SECRET_KEY,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  seed: {
    superAdmin: {
      name: process.env.SEED_SUPER_ADMIN_NAME || 'Super Admin',
      phone: process.env.SEED_SUPER_ADMIN_PHONE,
      password: process.env.SEED_SUPER_ADMIN_PASSWORD,
    },
    org: {
      name: process.env.SEED_ORG_NAME || 'Demo Organization',
      adminName: process.env.SEED_ORG_ADMIN_NAME || 'Org Admin',
      adminPhone: process.env.SEED_ORG_ADMIN_PHONE,
      adminPassword: process.env.SEED_ORG_ADMIN_PASSWORD,
    },
  },
};
