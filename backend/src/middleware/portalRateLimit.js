// Simple in-memory sliding-window rate limiter for the public customer
// portal (routes/portal.routes.js) — the one route in this API with no
// `authenticate` at all, so its only real protection is the token's entropy
// (see customers.portal_token in schema.sql) plus this: keyed by
// token+IP so repeated hammering of one link (a leaked URL, or someone
// trying to script a scrape) gets throttled. Not shared across multiple
// server instances/restarts — fine for this app's actual scale; a
// distributed store would be over-engineering here.
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

const hits = new Map();

function portalRateLimit(req, res, next) {
  const key = `${req.params.token}:${req.ip}`;
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }
  next();
}

// Stale-entry cleanup so `hits` doesn't grow unbounded on a long-running
// process. unref() so this timer never keeps the process alive on its own.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 5;
  for (const [key, entry] of hits.entries()) {
    if (entry.windowStart < cutoff) hits.delete(key);
  }
}, WINDOW_MS * 5).unref();

module.exports = portalRateLimit;
