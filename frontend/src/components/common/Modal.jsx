import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Modal.module.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, oldest first. Only the top-most one answers Esc / Tab, so a
// confirmation dialog on top of a form closes by itself and leaves the form open.
const openModals = [];

// size="wide" gives forms with a lot of fields more room.
export default function Modal({ title, onClose, children, footer, size }) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const token = {};
    openModals.push(token);
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;

    // Land inside the dialog so the keyboard starts there — unless the content
    // already put focus on one of its own fields.
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();

    function handleKeyDown(e) {
      if (openModals[openModals.length - 1] !== token) return;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab' && dialog) {
        // Keep Tab inside the dialog rather than wandering onto the page behind it.
        const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openModals.splice(openModals.indexOf(token), 1);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${size === 'wide' ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h3 id={titleId}>{title}</h3>
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
