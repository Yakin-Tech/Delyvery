import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PaymentStatusGroup.module.css';

export const PAYMENT_STATUSES = ['paid', 'partial', 'pending'];

// Paid / Part-paid / Not paid as a real radio group: one tab stop, arrow keys
// move and select, and 1 / 2 / 3 jump straight to an option.
export default function PaymentStatusGroup({ value, onChange, className = '' }) {
  const { t } = useTranslation();
  const buttonRefs = useRef([]);
  const labels = { paid: t('staffHome.paidNow'), partial: t('staffHome.partial'), pending: t('staffHome.notPaid') };

  function choose(index) {
    onChange(PAYMENT_STATUSES[index]);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(e) {
    const current = PAYMENT_STATUSES.indexOf(value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      choose((current + 1) % PAYMENT_STATUSES.length);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      choose((current - 1 + PAYMENT_STATUSES.length) % PAYMENT_STATUSES.length);
    } else if (['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      choose(Number(e.key) - 1);
    }
  }

  return (
    <div className={className}>
      <span className={styles.label}>{t('eod.payment')}</span>
      <div role="radiogroup" aria-label={t('eod.payment')} className={styles.group} onKeyDown={handleKeyDown}>
        {PAYMENT_STATUSES.map((status, index) => (
          <button
            key={status}
            ref={(el) => { buttonRefs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={value === status}
            tabIndex={value === status ? 0 : -1}
            className={`${styles.button} ${styles[status]} ${value === status ? styles.active : ''}`}
            onClick={() => onChange(status)}
          >
            {labels[status]}
            <span className={styles.keyHint}>{index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
