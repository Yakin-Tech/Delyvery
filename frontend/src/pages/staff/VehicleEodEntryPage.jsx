import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listVehicles } from '../../api/vehicles.api';
import { listProducts } from '../../api/products.api';
import { submitVehicleEodBatch } from '../../api/deliveries.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/common/Button';
import IconButton, { RowActions } from '../../components/common/IconButton';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Badge from '../../components/common/Badge';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import CustomerPicker from '../../components/common/CustomerPicker';
import Spinner from '../../components/common/Spinner';
import { generateClientRefId } from '../../offline/db';
import PaymentStatusGroup from '../../components/deliveries/PaymentStatusGroup';
import {
  blankEntry, applyCustomer, applyProduct, applyQuantity, applyUnitPrice, applyTotal, entryAmounts, entryPayload, validateEntry,
} from '../../utils/deliveryEntry';
import { localISODate } from '../../utils/dates';
import { PAYMENT_STATUS_TONE, formatCurrency } from '../../utils/paymentStatus';
import { orgUnitLabel } from '../../utils/businessTypes';
import styles from './VehicleEodEntryPage.module.css';


// Fields Enter walks through, in DOM order. Only the checked radio of the
// payment-status group is reachable (roving tabindex), so the group counts as
// one stop.
const FIELD_SELECTOR = 'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), button[role="combobox"]:not([disabled]), [role="radio"][tabindex="0"]';

// Entered-but-not-yet-submitted rows survive a refresh, a closed tab, or
// clicking over to another page — a long day's note is too much to retype.
const draftKey = (userId) => `delyver.eodDraft.${userId}`;

function readDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(userId, draft) {
  try {
    if (draft.rows.length === 0) localStorage.removeItem(draftKey(userId));
    else localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // Private mode / storage full — the draft just isn't kept.
  }
}

// client_ref_id doubles as the React key and as the idempotency key the
// server dedupes on, so re-submitting after a partial failure never records a
// row that already landed twice (see vehicleEodBatch in delivery.controller.js).
function makeEntry(organization) {
  return { client_ref_id: generateClientRefId(), ...blankEntry(organization) };
}

function toItem(row) {
  return { client_ref_id: row.client_ref_id, ...entryPayload(row) };
}

export default function VehicleEodEntryPage() {
  const { t } = useTranslation();
  const { organization, user } = useAuth();
  const [initialDraft] = useState(() => readDraft(user?.id));
  const [vehicles, setVehicles] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vehicleId, setVehicleId] = useState(initialDraft?.vehicleId || '');
  const [entryDate, setEntryDate] = useState(() => initialDraft?.entryDate || localISODate());
  const [rows, setRows] = useState(initialDraft?.rows || []);
  const [restoredCount, setRestoredCount] = useState(initialDraft?.rows?.length || 0);
  const [entry, setEntry] = useState(() => makeEntry(organization));
  const [editingId, setEditingId] = useState(null);
  const [entryError, setEntryError] = useState(null); // { field, message } | null
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null); // running tally of rows already submitted for this vehicle + date
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const [lastAdded, setLastAdded] = useState(null); // { n, name, amount } of the most recent Save & next

  const setupRef = useRef(null);
  const formRef = useRef(null);
  const customerBoxRef = useRef(null);
  const listBodyRef = useRef(null);
  const scrollToEnd = useRef(false);
  const shortcutActions = useRef({});

  useEffect(() => {
    Promise.all([
      listVehicles({ status: 'active', page_size: 100 }),
      listProducts({ page_size: 100 }),
    ])
      .then(([vehicleResult, productResult]) => {
        setVehicles(vehicleResult.data);
        setProducts(productResult.data);
        // A restored draft may point at a vehicle that has since been retired.
        setVehicleId((current) => (vehicleResult.data.some((v) => v.id === current) ? current : ''));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    writeDraft(user?.id, { vehicleId, entryDate, rows });
  }, [user?.id, vehicleId, entryDate, rows]);

  // Keyboard focus is requested by state and applied after the render that
  // follows, so the target field (the amount box that only exists once "Part
  // paid" is picked, the customer box after a reset) is already in the DOM.
  function requestFocus(field) {
    setFocusRequest((previous) => ({ field, n: (previous?.n || 0) + 1 }));
  }

  useEffect(() => {
    if (!focusRequest) return;
    const { field } = focusRequest;
    let element = null;
    if (field === 'vehicle' || field === 'entry_date') element = setupRef.current?.querySelector(`[name="${field}"]`);
    else if (field === 'customer') element = customerBoxRef.current?.querySelector('input');
    else element = formRef.current?.querySelector(`[name="${field}"]`);
    element?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (!loading && vehicles.length > 0) requestFocus(vehicleId ? 'customer' : 'vehicle');
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollToEnd.current && listBodyRef.current) {
      listBodyRef.current.scrollTop = listBodyRef.current.scrollHeight;
      scrollToEnd.current = false;
    }
  }, [rows]);

  const vehicle = vehicles.find((v) => v.id === vehicleId) || null;
  // Every row on the list belongs to one vehicle and day; letting either change
  // underneath them would quietly move the whole list onto a different one.
  const locked = rows.length > 0 && Boolean(vehicleId);
  const entryStarted = Boolean(entry.customerSelection);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    const { total, paid, pending } = entryAmounts(row);
    acc.total += total;
    acc.paid += paid;
    acc.pending += pending;
    return acc;
  }, { total: 0, paid: 0, pending: 0 }), [rows]);

  function updateEntry(updater) {
    setEntryError(null);
    setEntry(updater);
  }

  function handlePickerChange(next) {
    updateEntry((e) => applyCustomer(e, next, organization));
    // Choosing an existing customer leaves focus where it is (their name now sits
    // in the same box), so Enter/Tab moves on and Shift+Enter/Shift+Tab comes back.
    // A new customer needs their name/phone first, and clearing returns to the search.
    if (next?.mode !== 'existing') requestFocus('customer');
  }

  function handleProductChange(productId) {
    updateEntry((e) => applyProduct(e, products.find((p) => p.id === productId)));
  }

  // Quantity keeps whichever of price/total the person typed last fixed and
  // recomputes the other — same behaviour as the live delivery form.
  const handleQuantityChange = (value) => updateEntry((e) => applyQuantity(e, value));
  const handleUnitPriceChange = (value) => updateEntry((e) => applyUnitPrice(e, value));
  const handleTotalChange = (value) => updateEntry((e) => applyTotal(e, value));

  function resetEntry() {
    setEntry(makeEntry(organization));
    setEditingId(null);
    setEntryError(null);
  }

  function clearEntry() {
    resetEntry();
    requestFocus('customer');
  }

  // Ctrl+S / the Save button: validate, put the entry on the list, and hand
  // the person a blank form focused on the customer box — one delivery after
  // another without touching the mouse.
  function saveEntry() {
    if (!vehicleId) {
      setEntryError({ field: 'vehicle', message: t('eod.errors.vehicleRequired') });
      requestFocus('vehicle');
      return;
    }
    const problem = validateEntry(entry, t);
    if (problem) {
      setEntryError(problem);
      requestFocus(problem.field);
      return;
    }

    const row = { ...entry, error: '' };
    const position = editingId ? rows.findIndex((r) => r.client_ref_id === editingId) + 1 : rows.length + 1;
    setRows((prev) => (editingId ? prev.map((r) => (r.client_ref_id === editingId ? row : r)) : [...prev, row]));
    if (!editingId) scrollToEnd.current = true;
    setLastAdded({ n: position, name: row.customerSelection.name, amount: formatCurrency(entryAmounts(row).total), updated: Boolean(editingId) });
    setRestoredCount(0);
    setSubmitError('');
    resetEntry();
    requestFocus('customer');
  }

  function startEdit(row) {
    setEntry({ ...row, error: undefined });
    setEditingId(row.client_ref_id);
    setEntryError(row.error ? { field: null, message: row.error } : null);
    requestFocus('quantity');
  }

  function removeRow(id) {
    setRows((prev) => prev.filter((r) => r.client_ref_id !== id));
    if (editingId === id) resetEntry();
  }

  function discardAll() {
    setConfirmDiscard(false);
    setRows([]);
    setRestoredCount(0);
    setLastAdded(null);
    setSubmitError('');
    resetEntry();
    requestFocus('customer');
  }

  async function submitAll() {
    if (saving || rows.length === 0) return;
    setSubmitError('');
    if (!vehicleId) {
      requestFocus('vehicle');
      setSubmitError(t('eod.errors.vehicleRequired'));
      return;
    }
    // A customer picked in the form but never saved would be silently left
    // behind, so make the person decide about it first.
    if (entryStarted) {
      setEntryError({ field: null, message: t('eod.errors.unsavedEntry') });
      return;
    }

    setSaving(true);
    try {
      const { results } = await submitVehicleEodBatch({
        vehicle_id: vehicleId,
        entry_date: entryDate,
        items: rows.map(toItem),
      });

      const resultByRef = new Map(results.map((r) => [r.client_ref_id, r]));
      const landed = results.filter((r) => r.status === 'created' || r.status === 'already_synced');

      setSaved((prev) => ({
        count: (prev?.count || 0) + landed.length,
        value: (prev?.value || 0) + landed.reduce((sum, r) => sum + parseFloat(r.delivery.total_amount), 0),
        collected: (prev?.collected || 0) + landed.reduce((sum, r) => sum + parseFloat(r.delivery.amount_paid), 0),
      }));
      setRestoredCount(0);
      setLastAdded(null);

      // Saved rows leave the list; rows the server rejected stay, carrying that
      // row's own error message, so a single bad row never blocks the rest.
      setRows((prev) => prev
        .filter((row) => {
          const result = resultByRef.get(row.client_ref_id);
          return !result || result.status === 'error';
        })
        .map((row) => {
          const result = resultByRef.get(row.client_ref_id);
          return result ? { ...row, error: result.message } : row;
        }));

      const failed = results.length - landed.length;
      if (failed > 0) setSubmitError(t('eod.someFailed', { count: failed }));
      else requestFocus('customer');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S / Ctrl+Enter work from anywhere on the page. The handler reads the
  // latest closures through a ref so the window listener is attached once.
  shortcutActions.current = { saveEntry, submitAll, blocked: confirmDiscard };
  useEffect(() => {
    function handleShortcut(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || shortcutActions.current.blocked) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        shortcutActions.current.saveEntry();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        shortcutActions.current.submitAll();
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  // Enter walks forward through the form's fields (Shift+Enter walks back) and
  // Enter on the last one saves the entry. Buttons keep their normal Enter =
  // click; the customer search keeps Enter = "pick the highlighted match"
  // (it marks that keypress handled, which is why this bails on defaultPrevented).
  // Focus the field after (direction 1) or before (-1) `from`; Enter past the
  // last field saves the entry.
  function moveFocus(from, direction) {
    if (!from) return;
    const fields = Array.from(formRef.current.querySelectorAll(FIELD_SELECTOR));
    const next = fields[fields.indexOf(from) + direction];
    if (next) next.focus();
    else if (direction > 0) saveEntry();
  }

  // Dropdowns handle their own Enter (open / choose, and report the choice via
  // onCommit), so this only sees Enter from them with Shift held — "go back".
  function handleFormKeyDown(e) {
    if (e.defaultPrevented) return;
    const target = e.target;
    const role = target.getAttribute('role');
    const isCustomerInput = target.tagName === 'INPUT' && role === 'combobox';

    if (e.key === 'Escape') {
      // Esc also closes an open list (customer results, dropdowns) — don't wipe the form for that.
      if (role !== 'combobox') clearEntry();
      return;
    }
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (target.tagName === 'BUTTON' && role !== 'radio' && role !== 'combobox') return;

    e.preventDefault();
    // Nothing chosen in the customer box yet: stay put — a customer comes first.
    if (isCustomerInput && !entry.customerSelection) return;
    moveFocus(target, e.shiftKey ? -1 : 1);
  }

  // Focusing a number/text box selects its contents, so typing replaces the
  // default (quantity 1, the standard price) instead of appending to it.
  function handleFormFocus(e) {
    const target = e.target;
    if (target.tagName === 'INPUT' && ['text', 'number', 'tel'].includes(target.type)) {
      target.select();
    }
  }

  // Plain Enter on the vehicle dropdown belongs to the dropdown (it opens, then
  // chooses and reports back through onCommit); only the date field moves on.
  function handleSetupKeyDown(e) {
    if (e.defaultPrevented || e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.name === 'vehicle') return;
    e.preventDefault();
    if (vehicleId) requestFocus('customer');
    else requestFocus('vehicle');
  }

  if (loading) return <div className="page"><Spinner /></div>;

  const unit = orgUnitLabel(organization, t);
  const editingNumber = editingId ? rows.findIndex((r) => r.client_ref_id === editingId) + 1 : 0;
  const showProducts = organization?.products_enabled && products.length > 0;

  return (
    <div className="page">
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1>{t('eod.title')}</h1>
          <p className="mutedText">{t('eod.hint')}</p>
        </div>
        {vehicles.length > 0 && (
          <div className={styles.setup} ref={setupRef} onKeyDown={handleSetupKeyDown}>
            <Select
              name="vehicle"
              label={t('eod.vehicle')}
              value={vehicleId}
              disabled={locked}
              error={entryError?.field === 'vehicle' ? entryError.message : undefined}
              onChange={(e) => { setVehicleId(e.target.value); setSaved(null); setEntryError(null); }}
              onCommit={(source) => { if (source === 'keyboard') requestFocus('entry_date'); }}
            >
              <option value="">{t('eod.selectVehicle')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>
              ))}
            </Select>
            <TextInput
              name="entry_date"
              label={t('eod.date')}
              type="date"
              max={localISODate()}
              value={entryDate}
              disabled={locked}
              onChange={(e) => { setEntryDate(e.target.value); setSaved(null); }}
            />
          </div>
        )}
      </div>

      {vehicles.length === 0 ? (
        <div className="card"><p className="mutedText">{t('eod.noVehicles')}</p></div>
      ) : (
        <>
          {vehicle?.driver_name && (
            <p className={styles.driverLine}>{t('eod.driver', { name: vehicle.driver_name, phone: vehicle.driver_phone || '—' })}{locked ? ` · ${t('eod.lockedHint')}` : ''}</p>
          )}

          <p className={styles.shortcuts}>
            <span className={styles.kbd}>Enter</span> {t('eod.keys.next')} · <span className={styles.kbd}>Ctrl</span>+<span className={styles.kbd}>S</span> {t('eod.keys.save')} · <span className={styles.kbd}>Ctrl</span>+<span className={styles.kbd}>Enter</span> {t('eod.keys.submit')} · <span className={styles.kbd}>1</span> <span className={styles.kbd}>2</span> <span className={styles.kbd}>3</span> {t('eod.keys.status')} · <span className={styles.kbd}>Esc</span> {t('eod.keys.clear')}
          </p>
          {restoredCount > 0 && <div className={styles.banner}>{t('eod.restored', { count: restoredCount })}</div>}
          {saved && (
            <div className={styles.banner}>
              {t('eod.savedBanner', { count: saved.count, vehicle: vehicle?.vehicle_number || '', amount: formatCurrency(saved.value), collected: formatCurrency(saved.collected) })}
            </div>
          )}

          <div className={styles.workspaceWrap}>
          <div className={styles.workspace}>
            <section
              className={`card ${styles.formCard}`}
              ref={formRef}
              onKeyDown={handleFormKeyDown}
              onFocus={handleFormFocus}
              aria-label={t('eod.newEntry')}
            >
              <div className={styles.formHeader}>
                <h2 className={styles.formTitle}>{editingId ? t('eod.editingEntry', { n: editingNumber }) : t('eod.newEntry')}</h2>
                {editingId && <Badge tone="warning">{t('common.edit')}</Badge>}
              </div>

              {lastAdded && !editingId && (
                <p className={styles.lastAdded} role="status">
                  {t(lastAdded.updated ? 'eod.lastUpdated' : 'eod.lastAdded', { n: lastAdded.n, name: lastAdded.name, amount: lastAdded.amount })}
                </p>
              )}

              <div ref={customerBoxRef}>
                <CustomerPicker label={t('eod.customer')} value={entry.customerSelection} onChange={handlePickerChange} highlightFirst />
              </div>

              {showProducts && (
                <div className={styles.fieldRow}>
                  <Select
                    name="product_id"
                    label={t('common.product')}
                    value={entry.product_id}
                    onChange={(e) => handleProductChange(e.target.value)}
                    onCommit={(source) => { if (source === 'keyboard') moveFocus(formRef.current.querySelector('[name="product_id"]'), 1); }}
                  >
                    <option value="">{t('deliveries.modal.noProduct')}</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </div>
              )}

              <div className={`${styles.fieldRow} ${styles.cols3}`}>
                <TextInput
                  name="quantity"
                  label={t('staffHome.quantity', { unit })}
                  type="number" inputMode="decimal" step="0.01" min="0.01"
                  value={entry.quantity}
                  aria-invalid={entryError?.field === 'quantity' || undefined}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                />
                <TextInput
                  name="unit_price"
                  label={t('staffHome.pricePerUnit')}
                  type="number" inputMode="decimal" step="any" min="0"
                  value={entry.unit_price}
                  onChange={(e) => handleUnitPriceChange(e.target.value)}
                />
                <TextInput
                  name="total_amount"
                  label={t('staffHome.totalAmount')}
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={entry.total_amount}
                  aria-invalid={entryError?.field === 'total_amount' || undefined}
                  onChange={(e) => handleTotalChange(e.target.value)}
                />
              </div>

              <PaymentStatusGroup className={styles.paymentBlock} value={entry.payment_status} onChange={(status) => updateEntry((e) => ({ ...e, payment_status: status }))} />

              <div className={`${styles.fieldRow} ${styles.cols2}`}>
                {entry.payment_status === 'partial' && (
                  <TextInput
                    name="amount_paid"
                    label={t('staffHome.amountPaidNow')}
                    type="number" inputMode="decimal" step="0.01" min="0.01"
                    value={entry.amount_paid}
                    aria-invalid={entryError?.field === 'amount_paid' || undefined}
                    onChange={(e) => updateEntry((prev) => ({ ...prev, amount_paid: e.target.value }))}
                  />
                )}
                {entry.payment_status !== 'pending' && (
                  <Select
                    name="payment_mode"
                    label={t('staffHome.paymentMode')}
                    value={entry.payment_mode}
                    onChange={(e) => updateEntry((prev) => ({ ...prev, payment_mode: e.target.value }))}
                    onCommit={(source) => { if (source === 'keyboard') moveFocus(formRef.current.querySelector('[name="payment_mode"]'), 1); }}
                  >
                    <option value="cash">{t('staffHome.cash')}</option>
                    <option value="upi">{t('staffHome.upi')}</option>
                    <option value="bank_transfer">{t('staffHome.bankTransfer')}</option>
                    <option value="card">{t('staffHome.card')}</option>
                    <option value="other">{t('staffHome.other')}</option>
                  </Select>
                )}
                <TextInput
                  name="notes"
                  label={t('eod.note')}
                  className={entry.payment_status === 'paid' ? '' : styles.fullRow}
                  value={entry.notes}
                  onChange={(e) => updateEntry((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>


              {entryError && entryError.field !== 'vehicle' && <p className={`errorText ${styles.formError}`}>{entryError.message}</p>}

              <div className={styles.formActions}>
                <Button type="button" onClick={saveEntry}>{editingId ? t('eod.saveChanges') : t('eod.saveNext')}</Button>
                {(editingId || entryStarted) && <Button type="button" variant="secondary" onClick={clearEntry}>{editingId ? t('eod.cancelEdit') : t('eod.clearEntry')}</Button>}
              </div>

            </section>

            <section className={`card ${styles.listCard}`}>
              <div className={styles.listHeader}>
                <h2 className={styles.listTitle}>{t('eod.listTitle', { count: rows.length })}</h2>
                {rows.length > 0 && <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(true)}>{t('eod.discardAll')}</Button>}
              </div>

              <div className={styles.listBody} ref={listBodyRef}>
                {rows.length === 0 ? (
                  <p className={`mutedText ${styles.listEmpty}`}>{t('eod.listEmpty')}</p>
                ) : (
                  <ol className={styles.rowList}>
                    {rows.map((row, index) => {
                      const { total, paid, pending } = entryAmounts(row);
                      const isEditing = row.client_ref_id === editingId;
                      const details = [
                        `${row.quantity} ${unit}`,
                        row.payment_status === 'pending' ? null : t(`paymentModes.${row.payment_mode}`),
                        row.notes || null,
                      ].filter(Boolean).join(' · ');
                      return (
                        <li key={row.client_ref_id} className={`${styles.listRow} ${isEditing ? styles.rowEditing : ''} ${row.error ? styles.rowError : ''}`}>
                          <span className={styles.rowNumber}>{index + 1}</span>
                          <div className={styles.rowMain}>
                            <span className={styles.customerCell}>
                              <span className={styles.customerName}>{row.customerSelection.name}</span>
                              {row.customerSelection.mode === 'new' && <Badge tone="neutral">{t('eod.newTag')}</Badge>}
                            </span>
                            <span className={styles.rowMeta}>{details}</span>
                            {row.error && <span className={styles.rowMessage}>{row.error}</span>}
                          </div>
                          <div className={styles.rowAmount}>
                            <strong>{formatCurrency(total)}</strong>
                            <Badge tone={PAYMENT_STATUS_TONE[row.payment_status]}>{t(`badges.${row.payment_status}`)}</Badge>
                            {row.payment_status === 'partial' && <span className={styles.rowMeta}>{t('eod.paidDue', { paid: formatCurrency(paid), due: formatCurrency(pending) })}</span>}
                          </div>
                          <RowActions>
                            <IconButton icon="edit" label={t('common.edit')} onClick={() => startEdit(row)} />
                            <IconButton icon="delete" label={t('eod.removeRow')} onClick={() => removeRow(row.client_ref_id)} />
                          </RowActions>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <div className={styles.listFooter}>
                <div className={styles.totals}>
                  <span><span className={styles.totalLabel}>{t('eod.summary.totalValue')}</span><strong>{formatCurrency(totals.total)}</strong></span>
                  <span><span className={styles.totalLabel}>{t('eod.summary.collected')}</span><strong>{formatCurrency(totals.paid)}</strong></span>
                  <span><span className={styles.totalLabel}>{t('eod.summary.pending')}</span><strong>{formatCurrency(totals.pending)}</strong></span>
                </div>
                {submitError && <p className="errorText" style={{ marginTop: 0, marginBottom: 12 }}>{submitError}</p>}
                <div className={styles.submitRow}>
                  <Button type="button" onClick={submitAll} disabled={saving || rows.length === 0}>
                    {saving ? t('eod.saving') : t('eod.submitDay', { count: rows.length })}
                  </Button>
                  <span className="mutedText"><span className={styles.kbd}>Ctrl</span>+<span className={styles.kbd}>Enter</span></span>
                </div>
              </div>
            </section>
          </div>
          </div>
        </>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          message={t('eod.discardConfirm', { count: rows.length })}
          confirmLabel={t('eod.discardAll')}
          danger
          onConfirm={discardAll}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
