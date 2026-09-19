import { useTranslation } from 'react-i18next';
import styles from './BottomSheet.module.css';

// Mobile-first sibling to Modal: slides up from the bottom edge instead of
// popping in centered, so the customer's card stays visible above it and a
// staff member's thumb never has to travel far from where they just tapped.
// Same props shape as Modal (title/onClose/children/footer) so call sites can
// switch between the two without relearning an API.
export default function BottomSheet({ title, onClose, children, footer }) {
  const { t } = useTranslation();
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.grabber} />
        <div className={styles.header}>
          <h3>{title}</h3>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
