import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { formatMonthYear, formatShortDate } from '../../utils/paymentStatus';
import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

const DAILY_MAX_POINTS = 45;
const WEEKLY_MAX_POINTS = 200;

function weekStart(isoDate) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// A long run of daily rows makes an unreadable forest of bars, so past ~6 weeks
// they are added up into weeks, and past ~7 months into months.
// rows: [{ date, ...numbers }]; sumKeys: the numeric fields to add up.
export function aggregateByPeriod(rows, sumKeys) {
  if (rows.length <= DAILY_MAX_POINTS) return rows.map((r) => ({ ...r, label: formatShortDate(r.date) }));
  const monthly = rows.length > WEEKLY_MAX_POINTS;
  const groups = new Map();
  for (const row of rows) {
    const key = monthly ? row.date.slice(0, 7) : weekStart(row.date);
    if (!groups.has(key)) {
      groups.set(key, { date: monthly ? `${key}-01` : key, label: monthly ? formatMonthYear(`${key}-01`) : formatShortDate(key), ...Object.fromEntries(sumKeys.map((k) => [k, 0])) });
    }
    const group = groups.get(key);
    for (const k of sumKeys) group[k] += Number(row[k]) || 0;
  }
  return [...groups.values()];
}

// Bars over time. series: [{ key, name, color }]. Time-ordered rows go in, day / week /
// month buckets come out depending on how many there are. When the rows are already
// weekly or monthly buckets (granularity), they are drawn as they are.
export default function PeriodBars({ rows, series, format = (v) => v, stacked = false, granularity = 'day' }) {
  const data = granularity === 'day'
    ? aggregateByPeriod(rows, series.map((s) => s.key))
    : rows.map((r) => ({ ...r, label: granularity === 'month' ? formatMonthYear(r.date) : formatShortDate(r.date) }));
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={AXIS_TICK} width={48} allowDecimals={false} />
        <Tooltip formatter={(value) => format(value)} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-neutral-bg)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            stackId={stacked ? 'stack' : undefined}
            radius={stacked ? (i === series.length - 1 ? [6, 6, 0, 0] : 0) : [6, 6, 0, 0]}
            maxBarSize={36}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
