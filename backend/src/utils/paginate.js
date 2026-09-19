const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Reads page/page_size off req.query and returns the Supabase .range() bounds
// plus a buildResult() helper to shape the final { data, pagination } response.
function parsePagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return {
    page,
    pageSize,
    from,
    to,
    buildResult(data, total, extra = {}) {
      return {
        data,
        pagination: {
          page,
          page_size: pageSize,
          total: total || 0,
          total_pages: Math.max(Math.ceil((total || 0) / pageSize), 1),
        },
        ...extra,
      };
    },
  };
}

module.exports = { parsePagination };
