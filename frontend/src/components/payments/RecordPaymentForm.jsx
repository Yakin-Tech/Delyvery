import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCustomerDues } from '../../api/pendingDues.api';
import { createPayment } from '../../api/payments.api';
import { listVehicles } from '../../api/vehicles.api';
import { useAuth } from '../../context/AuthContext';
import useEnterNavigation from '../../hooks/useEnterNavigation';
import { generateClientRefId } from '../../offline/db';
import { localISODate } from '../../utils/dates';
import { formatCurrency, formatDate } from '../../utils/paymentStatus';
import { simulateFifo, simulateManual, dueAfterPayment, autoAllocate } from '../../utils/paymentPreview';
import Button from '../common/Button';
import TextInput from '../common/TextInput';
import Select from '../common/Select';
import Badge from '../common/Badge';
import Spinner from '../common/Spinner';
import ConfirmDialog from '../common/ConfirmDialog';
import styles from './RecordPaymentForm.module.css';

const VISIBLE_PENDING_ROWS = 4;

// Records money received from one customer against what they owe. It lives in a
// modal (RecordPaymentModal) opened from a customer's page or a dues row, and the
// modal closes once the payment is in.
//
// Because a recorded payment can't be edited afterwards, the form shows — live,
// as the amount is typed — exactly what the payment will do (what it clears, what
// is left owing, any surplus that becomes credit) and asks once more before
// saving anything larger than the customer owes. Saving is idempotent
// (client_ref_id), so a double Ctrl+S or a retry never counts the money twice.
export default function RecordPaymentForm({ customerId, onRecorded, onCancel }) {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const manualMode = organization?.payment_allocation_mode === 'manual';

  const formRef = useRef(null);

  const [dues, setDues] = useState(null);
  const [duesState, setDuesState] = useState('idle'); // idle | loading | error
  const [vehicles, setVehicles] = useState([]);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('cash');
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(() => localISODate());
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState({});
  const [showAllPending, setShowAllPending] = useState(false);
  const [clientRefId, setClientRefId] = useState(() => generateClientRefId());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [surplusToConfirm, setSurplusToConfirm] = useState(null);

  useEffect(() => {
    if (!vehicleOrg) return;
    listVehicles({ status: 'active', page_size: 100 }).then((r) => setVehicles(r.data)).catch(() => setVehicles([]));
  }, [vehicleOrg]);

  useEffect(() => {
    setDues(null);
    setAllocations({});
    setShowAllPending(false);
    let cancelled = false;
    setDuesState('loading');
    getCustomerDues(customerId)
      .then((result) => { if (!cancelled) { setDues(result); setDuesState('idle'); } })
      .catch(() => { if (!cancelled) setDuesState('error'); });
    return () => { cancelled = true; };
  }, [customerId]);

  const amountNumber = parseFloat(amount) || 0;
  const allocatedTotal = Object.values(allocations).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  const usingManual = manualMode && allocatedTotal > 0;

  const simulation = useMemo(() => {
    if (!dues) return null;
    return usingManual
      ? simulateManual({ deliveries: dues.pending_deliveries, allocations, amount: amountNumber })
      : simulateFifo({ openingBalance: dues.breakdown.opening_balance, deliveries: dues.pending_deliveries, amount: amountNumber });
  }, [dues, usingManual, allocations, amountNumber]);
  const dueAfter = dues && simulation ? dueAfterPayment(dues, simulation) : null;
  const settledCount = simulation ? simulation.lines.filter((l) => l.settled).length : 0;
  const partialCount = simulation ? simulation.lines.filter((l) => l.applied > 0 && !l.settled).length : 0;
  const lineByDelivery = simulation ? new Map(simulation.lines.map((l) => [l.delivery.id, l])) : new Map();

  function focusField(name) {
    formRef.current?.querySelector(`[name="${name}"]`)?.focus();
  }

  async function save(force = false) {
    if (saving) return;
    setError('');

    if (!(amountNumber > 0)) {
      setError(t('recordPayment.errors.amountRequired'));
      focusField('amount');
      return;
    }
    if (!date) {
      setError(t('recordPayment.errors.dateRequired'));
      focusField('payment_date');
      return;
    }
    if (usingManual && allocatedTotal > amountNumber + 0.005) {
      setError(t('recordPayment.errors.allocatedTooMuch', { allocated: formatCurrency(allocatedTotal), amount: formatCurrency(amountNumber) }));
      return;
    }
    // More than they owe: the extra becomes credit against a future delivery.
    // Worth one deliberate second look before it goes in.
    if (!force && simulation && simulation.surplus > 0.005) {
      setSurplusToConfirm(simulation.surplus);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        customer_id: customerId,
        amount: amountNumber,
        payment_mode: mode,
        payment_date: date,
        notes: notes.trim() || undefined,
        client_ref_id: clientRefId,
      };
      if (vehicleOrg && vehicleId) payload.vehicle_id = vehicleId;
      if (usingManual) {
        payload.allocations = Object.entries(allocations)
          .filter(([, value]) => parseFloat(value) > 0)
          .map(([delivery_id, value]) => ({ delivery_id, amount: parseFloat(value) }));
      }

      const result = await createPayment(payload);

      // The payment is in; a failure to re-read the balance must not look like one.
      let after = null;
      try { after = await getCustomerDues(customerId); } catch { /* shown without the new balance */ }

      setClientRefId(generateClientRefId());
      if (onRecorded) onRecorded({ result, dues: after, amount: amountNumber });
    } catch (err) {
      // clientRefId is kept on purpose: pressing save again is a safe retry.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S saves from anywhere on the page (or in the modal); with the
  // "more than they owe" question open it answers yes.
  const latest = useRef({});
  latest.current = { save, surplusToConfirm, setSurplusToConfirm };
  useEffect(() => {
    function handleShortcut(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's' || e.repeat) return;
      e.preventDefault();
      const { save: doSave, surplusToConfirm: pending, setSurplusToConfirm: setPending } = latest.current;
      if (pending !== null) {
        setPending(null);
        doSave(true);
      } else {
        doSave();
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => focusField('amount'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { moveFocus, onKeyDown, onFocus } = useEnterNavigation({
    containerRef: formRef,
    onLast: () => save(),
  });

  const pending = dues?.pending_deliveries || [];
  const visiblePending = showAllPending ? pending : pending.slice(0, VISIBLE_PENDING_ROWS);
  const breakdown = dues?.breakdown;
  const commitDropdown = (name) => (source) => {
    if (source === 'keyboard') moveFocus(formRef.current.querySelector(`[name="${name}"]`), 1);
  };

  return (
    <div ref={formRef} onKeyDown={onKeyDown} onFocus={onFocus} className={styles.form}>
      <div className={styles.locked}>
        <span className={styles.lockedName}>{dues?.customer?.name || '…'}</span>
        {dues?.customer?.phone && <span className={styles.lockedMeta}>{dues.customer.phone}</span>}
      </div>

      <div className={styles.duesBox}>
        {duesState === 'loading' && <Spinner label={t('recordPayment.loadingDues')} />}
        {duesState === 'error' && <p className="errorText" style={{ margin: 0 }}>{t('recordPayment.duesError')}</p>}
        {dues && (
          <>
            <div className={styles.owes}>
              <span className={styles.owesLabel}>{t('recordPayment.owes')}</span>
              <strong className={dues.total_due > 0 ? styles.owesDue : styles.owesClear}>{formatCurrency(dues.total_due)}</strong>
              {dues.customer.assigned_vehicle && <Badge tone="neutral">{dues.customer.assigned_vehicle.vehicle_number}</Badge>}
            </div>
            <p className={styles.breakdown}>
              {[
                breakdown.opening_balance > 0 && t('recordPayment.breakdown.opening', { amount: formatCurrency(breakdown.opening_balance) }),
                breakdown.delivery_due > 0 && t('recordPayment.breakdown.deliveries', { amount: formatCurrency(breakdown.delivery_due) }),
                breakdown.credit_notes_total > 0 && t('recordPayment.breakdown.creditNotes', { amount: formatCurrency(breakdown.credit_notes_total) }),
                breakdown.credit_balance > 0 && t('recordPayment.breakdown.credit', { amount: formatCurrency(breakdown.credit_balance) }),
              ].filter(Boolean).join(' · ') || t('recordPayment.nothingOwed')}
            </p>
          </>
        )}
      </div>

      <div className={styles.amountRow}>
        <TextInput
          name="amount"
          label={t('recordPayment.amount')}
          type="number" inputMode="decimal" step="0.01" min="0.01"
          value={amount}
          aria-invalid={error && !(amountNumber > 0) ? true : undefined}
          onChange={(e) => { setError(''); setAmount(e.target.value); }}
        />
        {dues && dues.total_due > 0 && (
          <Button type="button" variant="secondary" className={styles.fullDue} onClick={() => { setAmount(String(dues.total_due)); focusField('amount'); }}>
            {t('recordPayment.fullDue', { amount: formatCurrency(dues.total_due) })}
          </Button>
        )}
      </div>

      <div className={styles.grid2}>
        <Select
          name="payment_mode"
          label={t('staffHome.paymentMode')}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          onCommit={commitDropdown('payment_mode')}
        >
          <option value="cash">{t('staffHome.cash')}</option>
          <option value="upi">{t('staffHome.upi')}</option>
          <option value="bank_transfer">{t('staffHome.bankTransfer')}</option>
          <option value="card">{t('staffHome.card')}</option>
          <option value="other">{t('staffHome.other')}</option>
        </Select>
        {vehicleOrg && (
          <Select
            name="vehicle_id"
            label={t('recordPayment.collectedBy')}
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            onCommit={commitDropdown('vehicle_id')}
          >
            <option value="">{t('recordPayment.officePayment')}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)}
          </Select>
        )}
        <TextInput name="payment_date" label={t('recordPayment.date')} type="date" max={localISODate()} value={date} onChange={(e) => setDate(e.target.value)} />
        <TextInput name="notes" label={`${t('common.notes')} (${t('common.optional')})`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {dues && (
        <div className={styles.pendingBox}>
          <div className={styles.pendingHeader}>
            <span className={styles.sectionLabel}>{t('recordPayment.pendingDeliveries', { count: pending.length })}</span>
            {manualMode && pending.length > 0 && (
              <Button type="button" variant="ghost" className={styles.smallButton} onClick={() => setAllocations(autoAllocate(pending, amountNumber))}>
                {t('recordPayment.autoFill')}
              </Button>
            )}
          </div>

          {pending.length === 0 && <p className={styles.muted}>{t('recordPayment.noPendingDeliveries')}</p>}
          <ul className={styles.pendingList}>
            {visiblePending.map((d) => {
              const line = lineByDelivery.get(d.id);
              return (
                <li key={d.id} className={styles.pendingItem}>
                  <div className={styles.pendingMain}>
                    <span>{formatDate(d.delivery_date)}</span>
                    <span className={styles.muted}>
                      {[d.product?.name, d.vehicle?.vehicle_number, t('recordPayment.daysAgo', { count: d.days_pending })].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <strong className={styles.pendingAmount}>{formatCurrency(d.pending_amount)}</strong>
                  {manualMode ? (
                    <TextInput
                      name={`allocation_${d.id}`}
                      aria-label={t('recordPayment.allocateTo', { date: formatDate(d.delivery_date) })}
                      type="number" inputMode="decimal" step="0.01" min="0" max={d.pending_amount}
                      value={allocations[d.id] ?? ''}
                      className={styles.allocInput}
                      onChange={(e) => setAllocations((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    />
                  ) : (
                    line && line.applied > 0 && (
                      <Badge tone={line.settled ? 'success' : 'warning'}>
                        {line.settled ? t('recordPayment.settled') : t('recordPayment.partOf', { amount: formatCurrency(line.applied) })}
                      </Badge>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {pending.length > VISIBLE_PENDING_ROWS && (
            <button type="button" className={styles.linkButton} onClick={() => setShowAllPending((v) => !v)}>
              {showAllPending ? t('recordPayment.showFewer') : t('recordPayment.showAll', { count: pending.length })}
            </button>
          )}
        </div>
      )}

      {dues && simulation && amountNumber > 0 && (
        <div className={styles.preview} role="status">
          <div className={styles.previewTitle}>{t('recordPayment.previewTitle')}</div>
          <ul className={styles.previewLines}>
            {simulation.toOpening > 0 && <li>{t('recordPayment.preview.opening', { amount: formatCurrency(simulation.toOpening) })}</li>}
            {(settledCount > 0 || partialCount > 0) && (
              <li>
                {[
                  settledCount > 0 && t('recordPayment.preview.settles', { count: settledCount }),
                  partialCount > 0 && t('recordPayment.preview.partPays', { count: partialCount }),
                ].filter(Boolean).join(' · ')}
              </li>
            )}
          </ul>
          <div className={styles.after}>
            {t('recordPayment.dueAfter')} <strong>{formatCurrency(dueAfter)}</strong>
          </div>
          {simulation.surplus > 0.005 && (
            <p className={styles.warn}>{t('recordPayment.preview.surplus', { amount: formatCurrency(simulation.surplus) })}</p>
          )}
          {manualMode && allocatedTotal > 0 && (
            <p className={styles.muted}>{t('recordPayment.allocatedOf', { allocated: formatCurrency(allocatedTotal), total: formatCurrency(amountNumber) })}</p>
          )}
        </div>
      )}

      {error && <p className="errorText">{error}</p>}

      <div className={styles.actions}>
        <Button type="button" onClick={() => save()} disabled={saving}>{saving ? t('common.saving') : t('recordPayment.save')}</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>}
        <span className={styles.shortcutHint}><kbd>Ctrl</kbd>+<kbd>S</kbd></span>
      </div>

      {surplusToConfirm !== null && (
        <ConfirmDialog
          title={t('recordPayment.surplusTitle')}
          message={t('recordPayment.surplusConfirm', { amount: formatCurrency(amountNumber), surplus: formatCurrency(surplusToConfirm) })}
          confirmLabel={t('recordPayment.surplusRecord')}
          focusConfirm
          onConfirm={() => { setSurplusToConfirm(null); save(true); }}
          onCancel={() => { setSurplusToConfirm(null); focusField('amount'); }}
        />
      )}
    </div>
  );
}
