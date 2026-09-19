import styles from './Spinner.module.css';

export default function Spinner({ label = 'Loading…' }) {
  return (
    <div className={styles.wrapper} role="status" aria-live="polite">
      <span className={styles.spinner} />
      <span>{label}</span>
    </div>
  );
}
