import styles from './StatCard.module.css';

export function StatGrid({ children }) {
  return <div className={styles.grid}>{children}</div>;
}

export default function StatCard({ label, value }) {
  return (
    <div className={`card ${styles.statCard}`}>
      <div className="mutedText">{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
