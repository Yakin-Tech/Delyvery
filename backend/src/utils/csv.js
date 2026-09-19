// Shared CSV builder — extracted from pendingDues.controller.js's original
// inline implementation so every report's CSV export (Part 3) uses the same
// quoting rules instead of re-copying the escape logic per controller.
// `rows` is an array of arrays already in column order; every cell is
// stringified and quote-escaped, matching Excel/Sheets' expectations for a
// field that itself contains a comma or quote.
function buildCsv(headers, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return lines.join('\n');
}

// Sets the two headers every CSV download in this app needs, then sends it.
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

module.exports = { buildCsv, sendCsv };
