import styles from './ProgressBar.module.css';

export default function ProgressBar({ percent }) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className={styles.track}>
      <div className={styles.fill} style={{ width: `${pct}%` }} />
    </div>
  );
}
