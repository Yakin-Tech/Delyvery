import styles from './ChartCard.module.css';

// A titled card that holds one chart. `height` is the chart area; the card
// hides itself from print output only when told to (charts print fine).
export default function ChartCard({ title, subtitle, height = 260, children, className = '' }) {
  return (
    <section className={`card ${styles.card} ${className}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </header>
      <div className={styles.body} style={{ height }}>{children}</div>
    </section>
  );
}
