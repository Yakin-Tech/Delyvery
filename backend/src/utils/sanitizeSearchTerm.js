// Strip characters that would break PostgREST's or()/ilike filter syntax.
module.exports = function sanitizeSearchTerm(term) {
  return term.replace(/[,()*%]/g, ' ').trim();
};
