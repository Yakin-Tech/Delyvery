// "Today"/"Yesterday"/"Xm ago" style formatting for trust-signal timestamps
// (e.g. "last synced") — the design goal is to never show a bare ISO/ambiguous
// absolute date to a field-facing user. Takes `t` (react-i18next's translate
// function) so the labels themselves stay translatable, same as the rest of
// the app's non-hardcoded strings.
export default function formatRelativeTime(isoString, t) {
  if (!isoString) return '';
  const then = new Date(isoString);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  const diffMin = Math.floor((now - then) / 60000);

  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });

  const diffHours = Math.floor(diffMin / 60);
  if (then.toDateString() === now.toDateString()) return t('time.hoursAgo', { count: diffHours });

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDiff = Math.round((startOfToday - startOfThen) / 86400000);

  if (dayDiff === 1) return t('time.yesterday');
  if (dayDiff > 1) return t('time.daysAgo', { count: dayDiff });
  return t('time.today');
}
