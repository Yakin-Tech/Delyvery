import { localISODate } from './dates';

// Every preset the dashboard's period filter offers, in display order. Each
// resolves to a { date_from, date_to } pair (inclusive, ISO date strings) —
// deliberately computed client-side so "today" always means the viewer's own
// today rather than the server's.
export const DATE_RANGE_PRESETS = [
  'today', 'past7Days', 'past10Days', 'past1Month', 'thisMonth', 'lastMonth',
  'last3Months', 'past6Months', 'thisYear', 'lastYear', 'last3Years',
];

// The presets the reports offer: everything above plus yesterday and whole weeks
// (Monday to Sunday), which suit day-to-day questions better than a rolling 7 days.
export const REPORT_RANGE_PRESETS = [
  'today', 'yesterday', 'thisWeek', 'lastWeek', 'past7Days', 'past10Days', 'past1Month', 'thisMonth',
  'lastMonth', 'last3Months', 'past6Months', 'thisYear', 'lastYear', 'last3Years',
];

// The viewer's own calendar date — toISOString() is UTC, which is still
// "yesterday" for the first hours of an Indian morning.
const toISODate = (date) => localISODate(date);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// The Monday of the week a date falls in.
function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function computeDateRange(preset) {
  const today = new Date();
  const todayStr = toISODate(today);

  switch (preset) {
    case 'today':
      return { date_from: todayStr, date_to: todayStr };
    case 'yesterday': {
      const yesterday = toISODate(daysAgo(1));
      return { date_from: yesterday, date_to: yesterday };
    }
    case 'thisWeek':
      return { date_from: toISODate(startOfWeek(today)), date_to: todayStr };
    case 'lastWeek': {
      const monday = startOfWeek(today);
      monday.setDate(monday.getDate() - 7);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return { date_from: toISODate(monday), date_to: toISODate(sunday) };
    }
    case 'past7Days':
      return { date_from: toISODate(daysAgo(6)), date_to: todayStr };
    case 'past10Days':
      return { date_from: toISODate(daysAgo(9)), date_to: todayStr };
    case 'past1Month':
      return { date_from: toISODate(daysAgo(29)), date_to: todayStr };
    case 'thisMonth':
      return { date_from: toISODate(new Date(today.getFullYear(), today.getMonth(), 1)), date_to: todayStr };
    case 'lastMonth':
      return {
        date_from: toISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        date_to: toISODate(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case 'last3Months':
      return { date_from: toISODate(daysAgo(89)), date_to: todayStr };
    case 'past6Months':
      return { date_from: toISODate(daysAgo(179)), date_to: todayStr };
    case 'thisYear':
      return { date_from: toISODate(new Date(today.getFullYear(), 0, 1)), date_to: todayStr };
    case 'lastYear': {
      const y = today.getFullYear() - 1;
      return { date_from: `${y}-01-01`, date_to: `${y}-12-31` };
    }
    case 'last3Years':
      return { date_from: toISODate(new Date(today.getFullYear() - 3, today.getMonth(), today.getDate())), date_to: todayStr };
    default:
      return { date_from: todayStr, date_to: todayStr };
  }
}
