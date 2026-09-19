import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchTodayBoard, fetchRecentPlaces, dismissPlaceSuggestion, fetchMySummary } from '../../api/deliveries.api';
import { listProducts } from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import CustomerPicker from '../../components/common/CustomerPicker';
import PlaceInput from '../../components/common/PlaceInput';
import BottomSheet from '../../components/common/BottomSheet';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import ProgressBar from '../../components/common/ProgressBar';
import useSwipeGesture from '../../hooks/useSwipeGesture';
import { vibrateSuccess, vibrateWarn } from '../../utils/haptics';
import { enqueueDelivery, enqueueSkip, subscribeSyncStatus, dismissConflict } from '../../offline/syncManager';
import { totalFromUnitPrice, unitPriceFromTotal, quantityForProduct } from '../../utils/deliveryAmounts';
import { formatCurrency } from '../../utils/paymentStatus';
import { orgUnitLabel } from '../../utils/businessTypes';
import formatRelativeTime from '../../utils/formatRelativeTime';
import styles from './DailyRunSheetPage.module.css';

const SUNLIGHT_KEY = 'delyver.sunlightMode';
const MISSED_CUSTOMER_HOUR = 14; // 2 PM local time — see the spec's "missed customer" flow

function readSunlightMode() {
  try {
    return localStorage.getItem(SUNLIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

const SKIP_REASONS = ['not_home', 'customer_paused', 'out_of_stock', 'other'];

// "pending" only escalates to the alarming red once it's actually overdue
// (past the cutoff) — before that, "hasn't been visited yet" is just the
// normal, unremarkable state of most of the route, not a problem to flag.
function statusTone(status, missed) {
  if (status === 'delivered') return 'success';
  if (status === 'skipped') return 'neutral';
  return missed ? 'danger' : 'neutral';
}

// One route card: name/qty/price/status, tap-to-open, and swipe-right
// (Delivered + Paid, the fast path for a standard transaction) / swipe-left
// (Skip) via useSwipeGesture. This is its own component (not inlined in a
// .map() in the page) because a hook can't be called conditionally inside a
// loop — each card needs its own useSwipeGesture instance.
function RunSheetCard({ entry, unit, isPastCutoff, hasConflict, justDelivered, onTap, onQuickDeliver, onSwipeLeft }) {
  const { t } = useTranslation();
  const { customer, status } = entry;
  const { handlers, dragX, isDragging } = useSwipeGesture({
    onSwipeRight: () => onQuickDeliver(entry),
    onSwipeLeft: () => onSwipeLeft(entry),
    disabled: status !== 'pending',
  });

  const missed = status === 'pending' && isPastCutoff;
  const hintClass = dragX > 0 ? styles.hintRight : dragX < 0 ? styles.hintLeft : '';

  return (
    <div className={`${styles.cardOuter} ${hintClass} ${justDelivered ? styles.cardJustDelivered : ''}`}>
      {isDragging && (
        <div className={styles.swipeHint}>
          {dragX > 0 ? t('runSheet.swipeDeliveredPaid') : t('runSheet.swipeSkip')}
        </div>
      )}
      <button
        type="button"
        className={`${styles.card} ${missed ? styles.cardMissed : ''}`}
        style={isDragging ? { transform: `translateX(${dragX}px)` } : undefined}
        onClick={() => onTap(entry)}
        {...handlers}
      >
        <div className={styles.cardMain}>
          <div className={styles.customerName}>{customer.name}</div>
          <div className={styles.cardMeta}>
            {customer.default_quantity} {unit} · ₹{customer.custom_price_per_unit ?? '—'}
          </div>
        </div>
        <div className={styles.cardStatus}>
          {hasConflict && <Badge tone="warning">{t('runSheet.needsReview')}</Badge>}
          <Badge tone={statusTone(status, missed)}>{t(`runSheet.status.${status}`)}</Badge>
          {missed && <span className={styles.missedDot} aria-label={t('runSheet.missed')} />}
        </div>
      </button>
      {justDelivered && <div className={styles.deliveredCheck} aria-hidden="true">✓</div>}
    </div>
  );
}

export default function DailyRunSheetPage() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const [board, setBoard] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [logState, setLogState] = useState(null); // { source: 'board', entry } | { source: 'new' }
  const [form, setForm] = useState(null);
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [priceMode, setPriceMode] = useState('unit_price');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [skipTarget, setSkipTarget] = useState(null);
  const [skipReason, setSkipReason] = useState(SKIP_REASONS[0]);
  const [sunlightMode, setSunlightMode] = useState(readSunlightMode);
  const [syncStatus, setSyncStatus] = useState({ pendingCount: 0, conflicts: [], syncing: false, lastSyncedAt: null });
  const [warningsAcked, setWarningsAcked] = useState(false);
  const [recentlyDeliveredId, setRecentlyDeliveredId] = useState(null);
  const [celebration, setCelebration] = useState(null); // { deliveries, collected } | null

  useEffect(() => {
    document.documentElement.setAttribute('data-sunlight', sunlightMode ? 'true' : 'false');
    try { localStorage.setItem(SUNLIGHT_KEY, sunlightMode ? '1' : '0'); } catch { /* private mode, etc. */ }
    return () => document.documentElement.removeAttribute('data-sunlight');
  }, [sunlightMode]);

  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  // Full-screen completion celebration, shown once per day — a localStorage
  // flag (not just component state) so it doesn't refire if staff navigate
  // away and back to this page later the same day.
  useEffect(() => {
    if (loading || board.length === 0) return;
    const total = board.length;
    const done = board.filter((entry) => entry.status === 'delivered' || entry.status === 'skipped').length;
    if (done < total) return;

    const flagKey = `delyver.runsheet.celebrated.${new Date().toISOString().slice(0, 10)}`;
    try {
      if (localStorage.getItem(flagKey) === '1') return;
      localStorage.setItem(flagKey, '1');
    } catch {
      // Private mode, etc. — worst case the celebration can reappear later today.
    }

    fetchMySummary()
      .then((summary) => setCelebration({
        deliveries: summary?.today?.deliveries_count ?? done,
        collected: summary?.today?.collected ?? 0,
      }))
      .catch(() => setCelebration({ deliveries: done, collected: 0 }));
  }, [board, loading]);

  async function load() {
    setLoading(true);
    try {
      setBoard(await fetchTodayBoard());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); listProducts({ page_size: 100 }).then((r) => setProducts(r.data)); }, []);

  function updateLocalStatus(customerId, status) {
    setBoard((prev) => prev.map((entry) => (entry.customer.id === customerId ? { ...entry, status } : entry)));
  }

  function openBoardLog(entry) {
    const { customer } = entry;
    const unitPrice = customer.custom_price_per_unit ?? organization?.default_price_per_unit ?? 0;
    setWarningsAcked(false);
    setLogState({ source: 'board', entry });
    setForm({
      customerSelection: null,
      product_id: '',
      quantity: customer.default_quantity,
      unit_price: unitPrice,
      total_amount: totalFromUnitPrice(customer.default_quantity, unitPrice),
      place: '',
      payment_status: 'paid',
      amount_paid: '',
      payment_mode: 'cash',
    });
    setPriceMode('unit_price');
    setError('');
    fetchRecentPlaces(customer.id).then(setPlaceSuggestions);
  }

  function openNewCustomerLog() {
    const quantity = 1;
    const unitPrice = organization?.default_price_per_unit ?? 0;
    setWarningsAcked(false);
    setLogState({ source: 'new' });
    setForm({
      customerSelection: null,
      product_id: '',
      quantity,
      unit_price: unitPrice,
      total_amount: totalFromUnitPrice(quantity, unitPrice),
      place: '',
      payment_status: 'paid',
      amount_paid: '',
      payment_mode: 'cash',
    });
    setPriceMode('unit_price');
    setError('');
    setPlaceSuggestions([]);
  }

  function handlePickerChange(next) {
    setPriceMode('unit_price');
    setWarningsAcked(false);
    setForm((f) => {
      const updated = { ...f, customerSelection: next };
      if (next?.mode === 'existing') {
        updated.quantity = next.customer?.default_quantity ?? f.quantity;
        updated.unit_price = next.customer?.custom_price_per_unit ?? organization?.default_price_per_unit ?? f.unit_price;
      }
      updated.total_amount = totalFromUnitPrice(updated.quantity, updated.unit_price) || updated.total_amount;
      return updated;
    });

    if (next?.mode === 'existing') {
      fetchRecentPlaces(next.customer_id).then(setPlaceSuggestions);
    } else {
      setPlaceSuggestions([]);
    }
  }

  // Which customer place suggestions/dismissals are currently scoped to — the
  // board customer being logged, or whichever existing customer is picked in
  // the "log new customer" flow (a brand-new customer has no history yet).
  const activePlaceCustomerId = logState?.source === 'board'
    ? logState.entry.customer.id
    : (form?.customerSelection?.mode === 'existing' ? form.customerSelection.customer_id : null);

  function handleDismissPlace(place) {
    if (!activePlaceCustomerId) return;
    setPlaceSuggestions((prev) => prev.filter((p) => p !== place));
    dismissPlaceSuggestion(activePlaceCustomerId, place).catch((err) => console.error('Failed to dismiss place suggestion:', err));
  }

  function handleProductChange(productId) {
    setPriceMode('unit_price');
    setForm((f) => {
      const product = products.find((p) => p.id === productId);
      const unitPrice = product ? product.default_price : f.unit_price;
      const quantity = quantityForProduct(product, f.quantity);
      const next = { ...f, product_id: productId, quantity, unit_price: unitPrice };
      next.total_amount = totalFromUnitPrice(quantity, unitPrice) || next.total_amount;
      return next;
    });
  }

  function handleQuantityChange(value) {
    setWarningsAcked(false);
    setForm((f) => {
      const next = { ...f, quantity: value };
      if (priceMode === 'total_amount') {
        const computed = unitPriceFromTotal(value, f.total_amount);
        if (computed !== '') next.unit_price = computed;
      } else {
        const computed = totalFromUnitPrice(value, f.unit_price);
        if (computed !== '') next.total_amount = computed;
      }
      return next;
    });
  }

  function handleUnitPriceChange(value) {
    setPriceMode('unit_price');
    setWarningsAcked(false);
    setForm((f) => {
      const next = { ...f, unit_price: value };
      const computed = totalFromUnitPrice(f.quantity, value);
      if (computed !== '') next.total_amount = computed;
      return next;
    });
  }

  function handleTotalAmountChange(value) {
    setPriceMode('total_amount');
    setForm((f) => {
      const next = { ...f, total_amount: value };
      const computed = unitPriceFromTotal(f.quantity, value);
      if (computed !== '') next.unit_price = computed;
      return next;
    });
  }

  // The "usual" quantity/price to compare an entry against for the soft
  // anomaly warnings below — only known when the delivery is for a customer
  // already on file (board entry, or an existing customer picked via
  // CustomerPicker). A brand-new customer has no history to compare to, so
  // there's nothing to warn about.
  function getExpectedDefaults() {
    if (logState?.source === 'board') {
      const c = logState.entry.customer;
      return { quantity: c.default_quantity, unitPrice: c.custom_price_per_unit ?? organization?.default_price_per_unit ?? null };
    }
    if (form?.customerSelection?.mode === 'existing') {
      const c = form.customerSelection.customer;
      return { quantity: c?.default_quantity ?? null, unitPrice: c?.custom_price_per_unit ?? organization?.default_price_per_unit ?? null };
    }
    return { quantity: null, unitPrice: null };
  }

  function getQuantityWarning() {
    const { quantity: expected } = getExpectedDefaults();
    const entered = parseFloat(form?.quantity);
    if (!expected || !entered || Number.isNaN(entered) || entered <= expected * 3) return null;
    const name = logState.source === 'board' ? logState.entry.customer.name : form.customerSelection?.name;
    return t('runSheet.quantityWarning', { name, default: expected, unit: orgUnitLabel(organization, t), entered });
  }

  function getPriceWarning() {
    const { unitPrice: expected } = getExpectedDefaults();
    const entered = parseFloat(form?.unit_price);
    if (!expected || !entered || Number.isNaN(entered) || entered >= expected * 0.5) return null;
    return t('runSheet.priceWarning', { entered: formatCurrency(entered), usual: formatCurrency(expected) });
  }

  // Board entries already flag whether they were delivered today (see
  // todayBoard in delivery.controller.js) — used here to catch a staff
  // member picking an already-delivered customer through "Log new customer"
  // rather than tapping their existing card.
  function getDuplicateWarning() {
    if (logState?.source !== 'new' || form?.customerSelection?.mode !== 'existing') return null;
    const boardEntry = board.find((b) => b.customer.id === form.customerSelection.customer_id);
    if (!boardEntry?.delivered_today) return null;
    return t('runSheet.alreadyDeliveredWarning', {
      qty: boardEntry.todays_delivery?.quantity ?? '—',
      unit: orgUnitLabel(organization, t),
      amount: formatCurrency(boardEntry.todays_delivery?.total_amount || 0),
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (logState.source === 'new' && !form.customerSelection) {
      setError(t('customerPicker.noMatches'));
      return;
    }

    // Soft warnings (unusual quantity/price, already delivered today) don't
    // block saving — they just ask for one extra tap to confirm, instead of
    // an interrupting dialog. Changing any relevant field re-arms them (see
    // setWarningsAcked(false) in the handlers above).
    const hasWarnings = Boolean(getQuantityWarning() || getPriceWarning() || getDuplicateWarning());
    if (hasWarnings && !warningsAcked) {
      setWarningsAcked(true);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        product_id: form.product_id || undefined,
        quantity: form.quantity,
        unit_price: form.unit_price,
        total_amount: form.total_amount || undefined,
        place: form.place || undefined,
        payment_status: form.payment_status,
        amount_paid: form.payment_status === 'partial' ? form.amount_paid : undefined,
        payment_mode: form.payment_status === 'pending' ? undefined : form.payment_mode,
      };

      let customerId = null;
      if (logState.source === 'board') {
        customerId = logState.entry.customer.id;
        payload.customer_id = customerId;
      } else if (form.customerSelection.mode === 'existing') {
        customerId = form.customerSelection.customer_id;
        payload.customer_id = customerId;
      } else {
        payload.new_customer = { name: form.customerSelection.name, phone: form.customerSelection.phone || undefined };
      }

      // Every log goes through the offline queue first, then syncManager
      // flushes it (immediately, if online) — see offline/syncManager.js.
      // This makes "no signal at this doorstep" the normal path instead of a
      // special case bolted on afterward.
      await enqueueDelivery(payload);
      if (customerId) {
        updateLocalStatus(customerId, 'delivered');
        setRecentlyDeliveredId(customerId);
        setTimeout(() => setRecentlyDeliveredId((id) => (id === customerId ? null : id)), 700);
      }
      vibrateSuccess();
      setWarningsAcked(false);
      setLogState(null);
      if (logState.source === 'new') await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickDeliver(entry) {
    const { customer } = entry;
    const unitPrice = customer.custom_price_per_unit ?? organization?.default_price_per_unit ?? 0;
    const quantity = customer.default_quantity;
    await enqueueDelivery({
      customer_id: customer.id,
      quantity,
      unit_price: unitPrice,
      total_amount: totalFromUnitPrice(quantity, unitPrice) || undefined,
      payment_status: 'paid',
      payment_mode: 'cash',
    });
    updateLocalStatus(customer.id, 'delivered');
    vibrateSuccess();
    setRecentlyDeliveredId(customer.id);
    setTimeout(() => setRecentlyDeliveredId((id) => (id === customer.id ? null : id)), 700);
  }

  function openSkip(entry) {
    setSkipTarget(entry);
    setSkipReason(SKIP_REASONS[0]);
  }

  async function confirmSkip() {
    if (!skipTarget) return;
    const { customer } = skipTarget;
    await enqueueSkip({ customer_id: customer.id, reason: skipReason });
    updateLocalStatus(customer.id, 'skipped');
    vibrateWarn();
    setSkipTarget(null);
  }

  const filtered = board.filter((entry) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return entry.customer.name.toLowerCase().includes(term) || (entry.customer.phone || '').includes(term);
  });

  const isPastCutoff = new Date().getHours() >= MISSED_CUSTOMER_HOUR;
  const conflictCustomerIds = new Set(syncStatus.conflicts.map((c) => c.payload?.customer_id).filter(Boolean));
  const doneCount = board.filter((entry) => entry.status === 'delivered' || entry.status === 'skipped').length;

  const modalTitle = logState?.source === 'board'
    ? t('staffHome.modalTitle', { customer: logState.entry.customer.name })
    : (form?.customerSelection?.name ? t('staffHome.modalTitle', { customer: form.customerSelection.name }) : t('staffHome.logNewCustomer'));

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('runSheet.title')}</h1>
        <button
          type="button"
          className={`${styles.sunlightToggle} ${sunlightMode ? styles.sunlightToggleActive : ''}`}
          onClick={() => setSunlightMode((s) => !s)}
        >
          {t('runSheet.sunlightMode')}
        </button>
      </div>

      {/* The single most important element on this screen (see design notes):
          a passive "how much is left" signal, not a tappable control, so it's
          fine near the top even though buttons belong lower in the thumb zone. */}
      {!loading && board.length > 0 && (
        <div className={styles.progressHeader}>
          <ProgressBar percent={board.length > 0 ? (doneCount / board.length) * 100 : 0} />
          <span className={styles.progressLabel}>{t('runSheet.progress', { done: doneCount, total: board.length })}</span>
        </div>
      )}

      {(syncStatus.pendingCount > 0 || syncStatus.syncing) && (
        <div className={styles.syncBar}>
          {syncStatus.syncing ? <Spinner label={t('runSheet.syncing')} /> : <span>{t('runSheet.pendingSync', { count: syncStatus.pendingCount })}</span>}
        </div>
      )}

      {syncStatus.pendingCount === 0 && !syncStatus.syncing && syncStatus.lastSyncedAt && (
        <div className={styles.syncBar}>
          <span>{t('runSheet.syncedAgo', { time: formatRelativeTime(syncStatus.lastSyncedAt, t) })}</span>
        </div>
      )}

      {syncStatus.conflicts.map((c) => (
        <div key={c.client_ref_id} className={styles.conflictBanner}>
          <span>{t('runSheet.conflictMessage')}</span>
          <Button variant="ghost" onClick={() => dismissConflict(c.client_ref_id)}>{t('common.close')}</Button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <TextInput placeholder={t('staffHome.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <Button variant="secondary" onClick={openNewCustomerLog}>{t('staffHome.logNewCustomer')}</Button>
      </div>

      {loading ? <Spinner /> : (
        <div className={styles.list}>
          {filtered.map((entry) => (
            <RunSheetCard
              key={entry.customer.id}
              entry={entry}
              unit={orgUnitLabel(organization, t)}
              isPastCutoff={isPastCutoff}
              hasConflict={conflictCustomerIds.has(entry.customer.id)}
              justDelivered={entry.customer.id === recentlyDeliveredId}
              onTap={openBoardLog}
              onQuickDeliver={handleQuickDeliver}
              onSwipeLeft={openSkip}
            />
          ))}
          {filtered.length === 0 && <p className="mutedText">{t('staffHome.empty')}</p>}
        </div>
      )}

      {logState && form && (
        <BottomSheet title={modalTitle} onClose={() => setLogState(null)}>
          <form onSubmit={handleSubmit}>
            {logState.source === 'new' && (
              <div style={{ marginBottom: 16 }}>
                <CustomerPicker value={form.customerSelection} onChange={handlePickerChange} />
              </div>
            )}

            {getDuplicateWarning() && <p className={styles.formWarning}>{getDuplicateWarning()}</p>}

            <div className="formGrid">
              {organization?.products_enabled && products.length > 0 && (
                <Select label={t('common.product')} value={form.product_id} onChange={(e) => handleProductChange(e.target.value)}>
                  <option value="">{t('deliveries.modal.noProduct')}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              )}
              <TextInput
                label={t('staffHome.quantity', { unit: orgUnitLabel(organization, t) })}
                type="number" inputMode="decimal" step="0.01" min="0.01" required
                className={styles.bigInput}
                value={form.quantity}
                warn={getQuantityWarning()}
                onChange={(e) => handleQuantityChange(e.target.value)}
              />
              <TextInput
                label={t('staffHome.pricePerUnit')}
                type="number" inputMode="decimal" step="any" min="0" required
                value={form.unit_price}
                warn={getPriceWarning()}
                onChange={(e) => handleUnitPriceChange(e.target.value)}
              />
              <TextInput
                label={t('staffHome.totalAmount')}
                type="number" inputMode="decimal" step="0.01" min="0" required
                value={form.total_amount}
                onChange={(e) => handleTotalAmountChange(e.target.value)}
              />
            </div>

            <PlaceInput
              label={t('common.place')}
              value={form.place}
              onChange={(value) => setForm({ ...form, place: value })}
              suggestions={placeSuggestions}
              onDismissSuggestion={handleDismissPlace}
              style={{ marginTop: 16 }}
            />

            <div className={styles.statusButtons}>
              {['paid', 'partial', 'pending'].map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`${styles.statusButton} ${styles[status]} ${form.payment_status === status ? styles.statusButtonActive : ''}`}
                  onClick={() => setForm({ ...form, payment_status: status })}
                >
                  {status === 'paid' ? t('staffHome.paidNow') : status === 'partial' ? t('staffHome.partial') : t('staffHome.notPaid')}
                </button>
              ))}
            </div>

            {form.payment_status === 'partial' && (
              <TextInput
                label={t('staffHome.amountPaidNow')} type="number" inputMode="decimal" step="0.01" min="0.01" required
                value={form.amount_paid}
                onChange={(e) => setForm({ ...form, amount_paid: e.target.value })}
                style={{ marginTop: 16 }}
              />
            )}

            {form.payment_status !== 'pending' && (
              <Select label={t('staffHome.paymentMode')} value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })} style={{ marginTop: 16 }}>
                <option value="cash">{t('staffHome.cash')}</option>
                <option value="upi">{t('staffHome.upi')}</option>
                <option value="bank_transfer">{t('staffHome.bankTransfer')}</option>
                <option value="card">{t('staffHome.card')}</option>
                <option value="other">{t('staffHome.other')}</option>
              </Select>
            )}

            {error && <p className="errorText">{error}</p>}

            <div className={styles.deliverButtonRow}>
              <Button type="submit" disabled={saving} className={styles.deliverButton}>
                {saving
                  ? t('staffHome.saving')
                  : (!warningsAcked && (getQuantityWarning() || getPriceWarning() || getDuplicateWarning()))
                    ? t('runSheet.confirmAndLog')
                    : t('runSheet.deliverButton')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setLogState(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </BottomSheet>
      )}

      {celebration && (
        <div className={styles.celebrationOverlay} role="dialog" aria-modal="true">
          <div className={`card ${styles.celebrationCard}`}>
            <div className={styles.celebrationEmoji} aria-hidden="true">🎉</div>
            <h2>{t('runSheet.allDoneTitle')}</h2>
            <p>{t('runSheet.allDoneSummary', { count: celebration.deliveries, amount: formatCurrency(celebration.collected) })}</p>
            <Button onClick={() => setCelebration(null)}>{t('common.close')}</Button>
          </div>
        </div>
      )}

      {skipTarget && (
        <BottomSheet title={t('runSheet.skipTitle', { customer: skipTarget.customer.name })} onClose={() => setSkipTarget(null)}>
          <Select label={t('runSheet.skipReasonLabel')} value={skipReason} onChange={(e) => setSkipReason(e.target.value)}>
            {SKIP_REASONS.map((reason) => (
              <option key={reason} value={reason}>{t(`runSheet.skipReasons.${reason}`)}</option>
            ))}
          </Select>
          <div className="formActions">
            <Button variant="danger" onClick={confirmSkip}>{t('runSheet.confirmSkip')}</Button>
            <Button variant="secondary" onClick={() => setSkipTarget(null)}>{t('common.cancel')}</Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
