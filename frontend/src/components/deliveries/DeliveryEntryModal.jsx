import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createDelivery, updateDelivery, fetchRecentPlaces, dismissPlaceSuggestion } from '../../api/deliveries.api';
import { listProducts } from '../../api/products.api';
import { listVehicles } from '../../api/vehicles.api';
import { useAuth } from '../../context/AuthContext';
import useEnterNavigation from '../../hooks/useEnterNavigation';
import { blankEntry, applyCustomer, applyProduct, applyQuantity, applyUnitPrice, applyTotal, entryAmounts, entryPayload, validateEntry } from '../../utils/deliveryEntry';
import { localISODate } from '../../utils/dates';
import { formatCurrency } from '../../utils/paymentStatus';
import { orgUnitLabel } from '../../utils/businessTypes';
import Button from '../common/Button';
import CustomerPicker from '../common/CustomerPicker';
import Modal from '../common/Modal';
import PlaceInput from '../common/PlaceInput';
import Select from '../common/Select';
import TextInput from '../common/TextInput';
import PaymentStatusGroup from './PaymentStatusGroup';
import styles from './DeliveryEntryModal.module.css';

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other'];

function entryFromDelivery(delivery) {
  return {
    customerSelection: { mode: 'existing', customer_id: delivery.customer_id, name: delivery.customer?.name || '' },
    product_id: delivery.product_id || '',
    quantity: delivery.quantity,
    unit_price: delivery.unit_price_at_delivery,
    total_amount: delivery.total_amount,
    priceMode: 'unit_price',
    payment_status: delivery.payment_status,
    amount_paid: delivery.payment_status === 'partial' ? delivery.amount_paid : '',
    payment_mode: delivery.payment_mode || 'cash',
    notes: delivery.notes || '',
  };
}

// Adds a delivery (or edits one) for the org admin, keyboard-first like the
// office staff's entry screen: Enter walks the fields, 1/2/3 pick paid / part /
// not paid, Ctrl+S saves and leaves a blank form for the next delivery, and
// Ctrl+Enter saves and closes. Pass `customer` to fix the customer (from their
// own page) or `delivery` to edit an existing one.
export default function DeliveryEntryModal({ delivery = null, customer = null, onClose, onSaved }) {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const editing = Boolean(delivery);
  const lockedCustomer = editing || Boolean(customer);

  const fixedSelection = customer
    ? { mode: 'existing', customer_id: customer.id, name: customer.name, customer }
    : null;
  const makeFresh = () => (fixedSelection ? applyCustomer(blankEntry(organization), fixedSelection, organization) : blankEntry(organization));

  const [entry, setEntry] = useState(() => (editing ? entryFromDelivery(delivery) : makeFresh()));
  const [vehicleId, setVehicleId] = useState(() => (editing ? (delivery.vehicle_id || '') : (customer?.assigned_vehicle_id || '')));
  const [date, setDate] = useState(() => (editing ? delivery.delivery_date : localISODate()));
  const [place, setPlace] = useState(() => (editing ? (delivery.place || '') : ''));
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [products, setProducts] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [error, setError] = useState(null); // { field, message } | null
  const [saving, setSaving] = useState(false);
  const [lastAdded, setLastAdded] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const formRef = useRef(null);

  const showProducts = Boolean(organization?.products_enabled) && products.length > 0;
  const customerId = entry.customerSelection?.mode === 'existing' ? entry.customerSelection.customer_id : null;
  const unit = orgUnitLabel(organization, t);

  useEffect(() => {
    if (organization?.products_enabled) listProducts({ page_size: 100 }).then((r) => setProducts(r.data)).catch(() => setProducts([]));
    if (vehicleOrg) listVehicles({ status: 'active', page_size: 100 }).then((r) => setVehicles(r.data)).catch(() => setVehicles([]));
  }, [organization?.products_enabled, vehicleOrg]);

  // Places a customer has recently been delivered to, for the Place field.
  useEffect(() => {
    if (!customerId) { setPlaceSuggestions([]); return; }
    let cancelled = false;
    fetchRecentPlaces(customerId).then((places) => { if (!cancelled) setPlaceSuggestions(places); }).catch(() => {});
    return () => { cancelled = true; };
  }, [customerId]);

  function requestFocus(field) {
    setFocusRequest((previous) => ({ field, n: (previous?.n || 0) + 1 }));
  }

  useEffect(() => {
    const field = focusRequest?.field;
    if (!field || !formRef.current) return;
    const element = field === 'customer'
      ? formRef.current.querySelector('[data-customer-box] input')
      : formRef.current.querySelector(`[name="${field}"]`);
    element?.focus();
  }, [focusRequest]);

  // Start where the next thing to type is: the customer box, or the quantity
  // when the customer is already known.
  useEffect(() => {
    requestFocus(lockedCustomer ? 'quantity' : 'customer');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateEntry(updater) {
    setError(null);
    setEntry(updater);
  }

  function handlePickerChange(next) {
    updateEntry((e) => applyCustomer(e, next, organization));
    if (vehicleOrg && next?.mode === 'existing' && next.customer?.assigned_vehicle_id) setVehicleId(next.customer.assigned_vehicle_id);
    if (next?.mode !== 'existing') requestFocus('customer');
  }

  async function save({ addAnother }) {
    if (saving) return;
    const problem = validateEntry(entry, t);
    if (problem) {
      setError(problem);
      requestFocus(problem.field);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = { ...entryPayload(entry), vehicle_id: vehicleOrg ? (vehicleId || undefined) : undefined, place: place.trim() || undefined };
      let saved;
      if (editing) {
        delete payload.customer_id;
        delete payload.new_customer;
        saved = await updateDelivery(delivery.id, payload);
      } else {
        payload.delivery_date = date;
        saved = await createDelivery(payload);
      }
      if (onSaved) onSaved(saved);

      if (editing || !addAnother) {
        onClose();
        return;
      }
      setLastAdded({ name: entry.customerSelection.name, amount: formatCurrency(entryAmounts(entry).total) });
      setEntry(makeFresh());
      setPlace('');
      requestFocus(lockedCustomer ? 'quantity' : 'customer');
    } catch (err) {
      setError({ field: null, message: err.message });
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S / Ctrl+Enter work from anywhere in the dialog; the handler reads the
  // latest closure through a ref so the window listener is attached once.
  const latest = useRef({});
  latest.current = { save };
  useEffect(() => {
    function handleShortcut(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        latest.current.save({ addAnother: true });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        latest.current.save({ addAnother: false });
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const { moveFocus, onKeyDown, onFocus } = useEnterNavigation({
    containerRef: formRef,
    onLast: () => save({ addAnother: true }),
    canLeaveCustomerBox: () => Boolean(entry.customerSelection),
  });
  const commit = (name) => (source) => {
    if (source === 'keyboard') moveFocus(formRef.current.querySelector(`[name="${name}"]`), 1);
  };

  function handleDismissPlace(placeToDismiss) {
    if (!customerId) return;
    setPlaceSuggestions((prev) => prev.filter((p) => p !== placeToDismiss));
    dismissPlaceSuggestion(customerId, placeToDismiss).catch(() => {});
  }

  const title = editing
    ? t('deliveries.modal.editTitle')
    : (customer ? `${t('customers.detail.recordDelivery')} — ${customer.name}` : t('deliveries.modal.addTitle'));

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div ref={formRef} onKeyDown={onKeyDown} onFocus={onFocus} className={styles.form}>
        {lastAdded && !editing && (
          <p className={styles.lastAdded} role="status">{t('deliveries.entry.added', { name: lastAdded.name, amount: lastAdded.amount })}</p>
        )}

        <div data-customer-box>
          {lockedCustomer ? (
            <div className={styles.locked}>
              <span className={styles.lockedLabel}>{t('deliveries.modal.customer')}</span>
              <strong>{entry.customerSelection?.name}</strong>
            </div>
          ) : (
            <CustomerPicker label={t('deliveries.modal.customer')} value={entry.customerSelection} onChange={handlePickerChange} highlightFirst />
          )}
        </div>

        {showProducts && (
          <Select
            name="product_id"
            label={t('common.product')}
            value={entry.product_id}
            onChange={(e) => updateEntry((current) => applyProduct(current, products.find((p) => p.id === e.target.value)))}
            onCommit={commit('product_id')}
          >
            <option value="">{t('deliveries.modal.noProduct')}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}

        <div className={`${styles.row} ${styles.cols3}`}>
          <TextInput
            name="quantity"
            label={t('staffHome.quantity', { unit })}
            type="number" inputMode="decimal" step="0.01" min="0.01"
            value={entry.quantity}
            aria-invalid={error?.field === 'quantity' || undefined}
            onChange={(e) => updateEntry((current) => applyQuantity(current, e.target.value))}
          />
          <TextInput
            name="unit_price"
            label={t('staffHome.pricePerUnit')}
            type="number" inputMode="decimal" step="any" min="0"
            value={entry.unit_price}
            onChange={(e) => updateEntry((current) => applyUnitPrice(current, e.target.value))}
          />
          <TextInput
            name="total_amount"
            label={t('staffHome.totalAmount')}
            type="number" inputMode="decimal" step="0.01" min="0"
            value={entry.total_amount}
            aria-invalid={error?.field === 'total_amount' || undefined}
            onChange={(e) => updateEntry((current) => applyTotal(current, e.target.value))}
          />
        </div>

        <PaymentStatusGroup value={entry.payment_status} onChange={(status) => updateEntry((current) => ({ ...current, payment_status: status }))} />

        {entry.payment_status !== 'pending' && (
          <div className={`${styles.row} ${entry.payment_status === 'partial' ? styles.cols2 : ''}`}>
            {entry.payment_status === 'partial' && (
              <TextInput
                name="amount_paid"
                label={t('staffHome.amountPaidNow')}
                type="number" inputMode="decimal" step="0.01" min="0.01"
                value={entry.amount_paid}
                aria-invalid={error?.field === 'amount_paid' || undefined}
                onChange={(e) => updateEntry((current) => ({ ...current, amount_paid: e.target.value }))}
              />
            )}
            <Select
              name="payment_mode"
              label={t('staffHome.paymentMode')}
              value={entry.payment_mode}
              onChange={(e) => updateEntry((current) => ({ ...current, payment_mode: e.target.value }))}
              onCommit={commit('payment_mode')}
            >
              {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{t(`paymentModes.${mode}`)}</option>)}
            </Select>
          </div>
        )}

        <div className={`${styles.row} ${vehicleOrg ? styles.cols2 : ''}`}>
          {vehicleOrg && (
            <Select
              name="vehicle_id"
              label={t('deliveries.modal.vehicle')}
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              onCommit={commit('vehicle_id')}
            >
              <option value="">{editing ? t('deliveries.modal.noVehicle') : t('deliveries.modal.customersVehicle')}</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)}
            </Select>
          )}
          <TextInput
            name="delivery_date"
            label={t('deliveries.columns.date')}
            type="date"
            max={localISODate()}
            value={date}
            disabled={editing}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className={styles.row}>
          <PlaceInput label={t('common.place')} value={place} onChange={setPlace} suggestions={placeSuggestions} onDismissSuggestion={handleDismissPlace} />
        </div>

        <TextInput
          name="notes"
          label={`${t('common.notes')} (${t('common.optional')})`}
          value={entry.notes}
          onChange={(e) => updateEntry((current) => ({ ...current, notes: e.target.value }))}
        />

        {error && <p className="errorText" style={{ margin: 0 }}>{error.message}</p>}

        <div className={styles.actions}>
          {editing ? (
            <Button type="button" onClick={() => save({ addAnother: false })} disabled={saving}>{saving ? t('common.saving') : t('eod.saveChanges')}</Button>
          ) : (
            <>
              <Button type="button" onClick={() => save({ addAnother: true })} disabled={saving}>{saving ? t('common.saving') : t('eod.saveNext')}</Button>
              <Button type="button" variant="secondary" onClick={() => save({ addAnother: false })} disabled={saving}>{t('deliveries.entry.saveClose')}</Button>
            </>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        </div>
        <p className={styles.hint}>
          <kbd>Enter</kbd> {t('eod.keys.next')} · <kbd>Ctrl</kbd>+<kbd>S</kbd> {editing ? t('deliveries.entry.keySave') : t('eod.keys.save')}
          {!editing && <> · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> {t('deliveries.entry.keySaveClose')}</>}
          {' '}· <kbd>Esc</kbd> {t('deliveries.entry.keyClose')}
        </p>
      </div>
    </Modal>
  );
}
