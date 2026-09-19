import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import Button from './Button';

// Standard in-app "are you sure" dialog, replacing window.confirm() so a
// risky action gets the app's own UI (and a real, thumb-sized confirm
// button) instead of a native browser popup.
// focusConfirm puts keyboard focus on the confirm button, so Enter confirms and
// Esc-free keyboard flows (Ctrl+S then Enter) work. Off by default: for a
// destructive confirmation an errant Enter should never be the confirm.
export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, busy = false, focusConfirm = false, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <Modal
      title={title || t('common.areYouSure')}
      onClose={onCancel}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel || t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy} autoFocus={focusConfirm}>
            {busy ? t('common.saving') : (confirmLabel || t('common.confirm'))}
          </Button>
        </>
      )}
    >
      <p>{message}</p>
    </Modal>
  );
}
