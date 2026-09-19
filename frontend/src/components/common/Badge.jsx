import styles from './Badge.module.css';

const TONE_CLASS = {
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  neutral: styles.neutral,
};

export default function Badge({ tone = 'neutral', children }) {
  return <span className={`${styles.badge} ${TONE_CLASS[tone] || styles.neutral}`}>{children}</span>;
}
