import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';
import { AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from './chartTheme';

// Bars over named categories (products, vehicles, age buckets, customers...).
// series: [{ key, name, color }]. `horizontal` lays the categories down the side,
// which reads better for long names. With a single series and `colors`, each bar
// gets its own colour.
export default function CategoryBars({ data, categoryKey, series, format = (v) => v, horizontal = false, colors, categoryWidth = 120 }) {
  const layout = horizontal ? 'vertical' : 'horizontal';
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
            <YAxis type="category" dataKey={categoryKey} tick={AXIS_TICK} width={categoryWidth} interval={0} />
          </>
        ) : (
          <>
            <XAxis dataKey={categoryKey} tick={AXIS_TICK} interval={0} />
            <YAxis tick={AXIS_TICK} width={48} allowDecimals={false} />
          </>
        )}
        <Tooltip formatter={(value) => format(value)} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-neutral-bg)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} maxBarSize={horizontal ? 22 : 40}>
            {colors && series.length === 1 && data.map((entry, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
