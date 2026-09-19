import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal';
import RecordPaymentForm from './RecordPaymentForm';

// The record-payment form for one known customer, as a modal — opened from a
// customer's page or a row of a dues list. Closes itself once the payment is in.
export default function RecordPaymentModal({ customerId, customerName, onClose, onRecorded }) {
  const { t } = useTranslation();
  return (
    <Modal title={t('recordPayment.modalTitle', { name: customerName })} onClose={onClose}>
      <RecordPaymentForm
        customerId={customerId}
        onCancel={onClose}
        onRecorded={(recorded) => {
          if (onRecorded) onRecorded(recorded);
          onClose();
        }}
      />
    </Modal>
  );
}
