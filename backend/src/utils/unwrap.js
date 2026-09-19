const ApiError = require('./ApiError');

// Postgres SQLSTATE codes PostgREST passes through on error.code that we want to
// map to a client error instead of a generic 500.
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

// supabase-js never throws on a query error — it resolves { data, error }.
// unwrap() turns that into either the data or a thrown ApiError, so controllers
// can use normal try/catch-free async flow (asyncHandler forwards it to errorHandler).
function unwrap({ data, error }) {
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw ApiError.conflict('A record with that value already exists');
    }
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      throw ApiError.badRequest('Referenced record does not exist');
    }
    throw new ApiError(500, error.message, error.details || null);
  }
  return data;
}

// Same as unwrap(), but also passes through the row count Supabase returns
// when a query is built with .select(cols, { count: 'exact' }).
function unwrapPage({ data, error, count }) {
  if (error) {
    throw new ApiError(500, error.message, error.details || null);
  }
  return { data, count };
}

module.exports = unwrap;
module.exports.unwrapPage = unwrapPage;
