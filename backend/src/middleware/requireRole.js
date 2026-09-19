const ApiError = require('../utils/ApiError');

// requireRole('org_admin', 'staff') -> middleware that 403s anyone else.
// Must run after `authenticate`.
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};

module.exports = requireRole;
