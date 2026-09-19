import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { TOOLTIP_STYLE } from './chartTheme';
import styles from './DonutChart.module.css';

// A donut with its legend beside it. Each slice reads out its name, value and
// share of the whole. data: [{ name, value, color }]; slices with no value are
// dropped. `format` turns a value into text (currency, a count...).
export default function DonutChart({ data, format = (v) => String(v), emptyLabel }) {
  const slices = data.filter((d) => d.value > 0);
  const total = slices.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) return <p className={`mutedText ${styles.empty}`}>{emptyLabel}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={slices.length > 1 ? 2 : 0} stroke="var(--color-surface)" strokeWidth={2}>
              {slices.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [format(value), name]} contentStyle={TOOLTIP_STYLE} itemStyle={{ color: 'var(--color-text)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className={styles.legend}>
        {slices.map((slice) => (
          <li key={slice.name} className={styles.legendItem}>
            <span className={styles.dot} style={{ background: slice.color }} />
            <span className={styles.legendName}>{slice.name}</span>
            <span className={styles.legendValue}>{format(slice.value)}</span>
            <span className={styles.legendShare}>{Math.round((slice.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
