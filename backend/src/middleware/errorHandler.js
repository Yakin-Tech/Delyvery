const ApiError = require('../utils/ApiError');
const { recordActivity } = require('../services/activityLog.service');

// Only server-side failures count toward Super Admin's error-rate widget — a
// validation 400 or an expected 403/404 is normal traffic, not an incident.
function logServerError(statusCode, req, message) {
  if (statusCode < 500) return;
  recordActivity({
    organizationId: req.user?.organizationId || null,
    userId: req.user?.id || null,
    eventType: 'error',
    metadata: { method: req.method, path: req.originalUrl, status: statusCode, message },
  });
}

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof ApiError) {
    logServerError(err.statusCode, req, err.message);
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details || undefined,
    });
  }

  console.error(err);
  logServerError(500, req, err.message);
  return res.status(500).json({ error: 'Internal server error' });
};

module.exports = errorHandler;
