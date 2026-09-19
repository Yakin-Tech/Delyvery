// Local calendar date (YYYY-MM-DD), not toISOString() (UTC): someone keying in
// the day's records in the evening is, in a UTC+5:30 timezone, still on
// "yesterday" in UTC until 5:30 AM.
export function localISODate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
