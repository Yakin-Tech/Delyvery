import styles from './FAB.module.css';

// Floating action button — shown only on narrow/mobile widths (see the
// media query in FAB.module.css) for the one action a small-business owner
// reaches for most on their phone. Deliberately a single fixed action rather
// than a speed-dial menu: the point is a one-thumb tap, not another menu.
export default function FAB({ label, onClick }) {
  return (
    <button type="button" className={`${styles.fab} no-print`} onClick={onClick} aria-label={label}>
      <span className={styles.icon} aria-hidden="true">+</span>
    </button>
  );
}
