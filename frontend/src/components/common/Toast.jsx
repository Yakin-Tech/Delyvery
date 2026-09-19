import { useTranslation } from 'react-i18next';
import styles from './Toast.module.css';

// Bottom-anchored, non-blocking notice — used for the "Undo" trust pattern:
// an action already happened (or looks like it did) but there's a short
// window to reverse it instead of a dialog asking "are you sure" up front.
export default function Toast({ message, actionLabel, onAction, onDismiss }) {
  const { t } = useTranslation();
  return (
    <div className={styles.toast} role="status">
      <span className={styles.message}>{message}</span>
      <div className={styles.actions}>
        {actionLabel && onAction && (
          <button type="button" className={styles.action} onClick={onAction}>{actionLabel}</button>
        )}
        {onDismiss && (
          <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label={t('common.dismiss')}>×</button>
        )}
      </div>
    </div>
  );
}
