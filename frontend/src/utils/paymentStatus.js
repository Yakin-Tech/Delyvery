import i18next from '../i18n';

export const PAYMENT_STATUS_TONE = {
  paid: 'success',
  partial: 'warning',
  pending: 'danger',
};

const LOCALE_BY_LANGUAGE = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ml: 'ml-IN', ta: 'ta-IN', te: 'te-IN' };
const currentLocale = () => LOCALE_BY_LANGUAGE[i18next.language] || 'en-IN';

export function formatCurrency(amount) {
  const value = Number(amount) || 0;
  return `₹${value.toFixed(2)}`;
}

// A price per unit can be finer than paise (₹0.425 a litre): show what is stored,
// never fewer than two decimals.
export function formatUnitPrice(amount) {
  const [whole, fraction = ''] = (Number(amount) || 0).toFixed(6).split('.');
  return `₹${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

// A bare YYYY-MM-DD is a calendar date, not an instant — format it as itself
// rather than shifting it by the viewer's timezone. Month names follow the
// language the app is currently shown in.
function formatWith(dateStr, options) {
  if (!dateStr) return '—';
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(currentLocale(), calendarDate ? { ...options, timeZone: 'UTC' } : options);
}

export function formatDate(dateStr) {
  return formatWith(dateStr, { day: '2-digit', month: 'short', year: 'numeric' });
}

// "17 Sep" — for chart axes and other tight spots.
export function formatShortDate(dateStr) {
  return formatWith(dateStr, { day: 'numeric', month: 'short' });
}

// "Sep 26" — a month on a chart axis.
export function formatMonthYear(dateStr) {
  return formatWith(dateStr, { month: 'short', year: '2-digit' });
}

// "September 2026" — a whole month, for a table row.
export function formatMonthLong(dateStr) {
  return formatWith(dateStr, { month: 'long', year: 'numeric' });
}

// "Jan" — a month's short name from its number ("01"-"12").
export function formatMonthName(month) {
  return formatWith(`2000-${month}-01`, { month: 'short' });
}
