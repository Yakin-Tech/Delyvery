const { validationResult } = require('express-validator');
const ApiError = require('./ApiError');

// Run after a chain of express-validator checks; turns their errors into an ApiError.
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(ApiError.badRequest('Validation failed', errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }))));
  }
  next();
};

module.exports = validate;
