import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getCustomer, updateCustomer, topUpWallet, getPortalLink } from '../../api/customers.api';
import { createDeposit, recordDepositReturn } from '../../api/customerDeposits.api';
import { createCreditNote, voidCreditNote } from '../../api/creditNotes.api';
import { useAuth } from '../../context/AuthContext';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { getTranslatorFor, resolveCustomerLanguage } from '../../i18n/tForLanguage';
import Button from '../../components/common/Button';
import IconButton from '../../components/common/IconButton';
import CustomerOrders from '../../components/customers/CustomerOrders';
import DeliveryEntryModal from '../../components/deliveries/DeliveryEntryModal';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import TextInput from '../../components/common/TextInput';
import Modal from '../../components/common/Modal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Select from '../../components/common/Select';
import { PAYMENT_STATUS_TONE, formatCurrency, formatDate } from '../../utils/paymentStatus';

const DEPOSIT_STATUS_TONE = { held: 'warning', partially_returned: 'neutral', fully_returned: 'success' };
const OVERDUE_DAYS = 30;

// A single chronological "bank statement" of everything that moves this
// customer's balance: opening balance, deliveries (net of their own
// amount_paid, whatever funded it), non-voided credit notes, and — as a
// zero-effect informational row — lump-sum payments. Payments show 0 net
// effect here deliberately: apply_payment_fifo/manual already writes
// straight onto the deliveries they settle (linked_delivery_ids), so a
// delivery's current amount_paid already reflects any payment applied to
// it — subtracting the payment amount again here would double-count the
// same money. Any leftover overpayment sitting as customers.credit_balance
// (not yet attached to a delivery) is the one remaining adjustment, applied
// as a final synthetic row — with it, the ledger's ending balance is exactly
// utils/customerLedger.js's computeTotalDue (unfloored, so unlike the
// header stat it can go negative to show a customer is in credit).
function buildLedger(data) {
  const { customer, deliveries, payments, credit_notes: creditNotes } = data;
  const events = [];

  const openingBalance = parseFloat(customer.opening_balance) || 0;
  if (openingBalance > 0) {
    events.push({ key: 'opening', type: 'opening', netEffect: openingBalance });
  }

  const dated = [];
  for (const d of deliveries) {
    const total = parseFloat(d.total_amount);
    const paid = parseFloat(d.amount_paid);
    dated.push({ key: `delivery-${d.id}`, type: 'delivery', delivery: d, netEffect: Math.max(total - paid, 0), sortKey: d.delivery_time || `${d.delivery_date}T00:00:00.000Z` });
  }
  for (const p of payments) {
    dated.push({ key: `payment-${p.id}`, type: 'payment', payment: p, netEffect: 0, sortKey: `${p.payment_date}T12:00:00.000Z` });
  }
  for (const n of creditNotes) {
    if (n.voided_at) continue;
    dated.push({ key: `creditnote-${n.id}`, type: 'credit_note', creditNote: n, netEffect: -parseFloat(n.amount), sortKey: n.issued_at });
  }
  dated.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  events.push(...dated);

  const creditBalance = parseFloat(customer.credit_balance) || 0;
  if (creditBalance > 0) {
    events.push({ key: 'credit-balance', type: 'credit_balance', netEffect: -creditBalance });
  }

  let running = 0;
  return events.map((e) => {
    running += e.netEffect;
    return { ...e, balanceAfter: Math.round(running * 100) / 100 };
  });
}

export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { organization } = useAuth();
  const [data, setData] = useState(null);
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  // Record Delivery (quick action)
  const [showDelivery, setShowDelivery] = useState(false);

  // Payment
  const [showPayment, setShowPayment] = useState(false);

  // Deposits
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ item_name: '', quantity_deposited: 1, deposit_amount_per_item: '' });
  const [depositError, setDepositError] = useState('');
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnAmount, setReturnAmount] = useState('');

  // Credit notes
  const [showCreditNote, setShowCreditNote] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState({ amount: '', reason: '' });
  const [creditNoteError, setCreditNoteError] = useState('');
  const [voidTargetId, setVoidTargetId] = useState(null);

  // Wallet top-up
  const [showWalletTopup, setShowWalletTopup] = useState(false);
  const [walletTopupForm, setWalletTopupForm] = useState({ amount: '', payment_mode: 'cash', notes: '' });
  const [walletTopupError, setWalletTopupError] = useState('');
  const [walletTopupSaving, setWalletTopupSaving] = useState(false);
  const [portalLinkBusy, setPortalLinkBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await getCustomer(id));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setEditForm({
      name: data.customer.name,
      phone: data.customer.phone || '',
      address: data.customer.address || '',
      default_quantity: data.customer.default_quantity,
      custom_price_per_unit: data.customer.custom_price_per_unit ?? '',
      opening_balance: data.customer.opening_balance ?? 0,
      status: data.customer.status,
      preferred_language: data.customer.preferred_language || '',
    });
    setEditing(true);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    await updateCustomer(id, {
      ...editForm,
      custom_price_per_unit: editForm.custom_price_per_unit === '' ? null : editForm.custom_price_per_unit,
      preferred_language: editForm.preferred_language || null,
    });
    setEditing(false);
    await load();
  }

  function openDeposit() {
    setDepositForm({ item_name: '', quantity_deposited: 1, deposit_amount_per_item: '' });
    setDepositError('');
    setShowDeposit(true);
  }

  async function handleCreateDeposit(e) {
    e.preventDefault();
    setDepositError('');
    try {
      await createDeposit({ customer_id: id, ...depositForm });
      setShowDeposit(false);
      await load();
    } catch (err) {
      setDepositError(err.message);
    }
  }

  function openReturn(deposit) {
    setReturnTarget(deposit);
    setReturnAmount('');
  }

  async function handleRecordReturn(e) {
    e.preventDefault();
    await recordDepositReturn(returnTarget.id, returnAmount);
    setReturnTarget(null);
    await load();
  }

  function openCreditNote() {
    setCreditNoteForm({ amount: '', reason: '' });
    setCreditNoteError('');
    setShowCreditNote(true);
  }

  async function handleCreateCreditNote(e) {
    e.preventDefault();
    setCreditNoteError('');
    try {
      await createCreditNote({ customer_id: id, ...creditNoteForm });
      setShowCreditNote(false);
      await load();
    } catch (err) {
      setCreditNoteError(err.message);
    }
  }

  async function confirmVoidCreditNote() {
    const noteId = voidTargetId;
    setVoidTargetId(null);
    await voidCreditNote(noteId);
    await load();
  }

  function openWalletTopup() {
    setWalletTopupForm({ amount: '', payment_mode: 'cash', notes: '' });
    setWalletTopupError('');
    setShowWalletTopup(true);
  }

  async function handleWalletTopup(e) {
    e.preventDefault();
    setWalletTopupError('');
    setWalletTopupSaving(true);
    try {
      await topUpWallet(id, walletTopupForm);
      setShowWalletTopup(false);
      await load();
    } catch (err) {
      setWalletTopupError(err.message);
    } finally {
      setWalletTopupSaving(false);
    }
  }

  // Sends the customer their own reminder/statement in THEIR language, not
  // the admin's active UI language — see i18n/tForLanguage.js.
  function sendWhatsApp(templateKey, values) {
    const tFor = getTranslatorFor(resolveCustomerLanguage(data.customer, organization));
    const text = tFor(templateKey, values);
    window.open(`https://wa.me/${data.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  function handleSendReminder() {
    sendWhatsApp('customers.detail.whatsappReminder', {
      name: data.customer.name,
      business: organization?.name || '',
      amount: formatCurrency(data.total_due),
      phone: organization?.phone_numbers?.[0] || '',
    });
  }

  function handleSendMonthlyStatement() {
    const monthDeliveries = data.deliveries.filter((d) => d.delivery_date.slice(0, 7) === new Date().toISOString().slice(0, 7));
    const totalThisMonth = monthDeliveries.reduce((sum, d) => sum + parseFloat(d.total_amount), 0);
    const collectedThisMonth = monthDeliveries.reduce((sum, d) => sum + parseFloat(d.amount_paid), 0);
    sendWhatsApp('customers.detail.whatsappMonthlyStatement', {
      name: data.customer.name,
      business: organization?.name || '',
      deliveries: monthDeliveries.length,
      total: formatCurrency(totalThisMonth),
      collected: formatCurrency(collectedThisMonth),
      due: formatCurrency(data.total_due),
    });
  }

  async function handleGetPortalLink() {
    setPortalLinkBusy(true);
    try {
      const { portal_token } = await getPortalLink(id);
      const url = `${window.location.origin}/portal/${portal_token}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        window.alert(t('customers.detail.portalLinkCopied'));
      } else {
        window.prompt(t('customers.detail.portalLinkPrompt'), url);
      }
    } finally {
      setPortalLinkBusy(false);
    }
  }

  const ledger = useMemo(() => (data ? buildLedger(data) : []), [data]);
  const overdueCount = useMemo(() => {
    if (!data) return 0;
    const cutoff = Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000;
    return data.deliveries.filter((d) => d.payment_status !== 'paid' && new Date(d.delivery_date).getTime() < cutoff).length;
  }, [data]);

  if (loading || !data) return <Spinner />;

  const { customer, payments, credit_notes: creditNotes, deposits, total_due } = data;

  const ledgerColumns = [
    { key: 'date', header: t('deliveries.columns.date'), render: (r) => (r.type === 'opening' ? '—' : r.type === 'credit_balance' ? t('customers.detail.ledger.asOfToday') : formatDate(r.delivery?.delivery_date || r.payment?.payment_date || r.creditNote?.issued_at)) },
    {
      key: 'description',
      header: t('customers.detail.ledger.description'),
      render: (r) => {
        if (r.type === 'opening') return t('customers.detail.openingBalanceLine');
        if (r.type === 'credit_balance') {
          return (
            <>
              {t('customers.detail.ledger.unusedCredit')}
              {data.wallet_projection && (
                <div className="mutedText" style={{ fontSize: 12 }}>
                  {t('customers.detail.ledger.daysRemaining', { count: data.wallet_projection.days_remaining })}
                </div>
              )}
            </>
          );
        }
        if (r.type === 'delivery') return `${t('customers.detail.ledger.delivery')} — ${r.delivery.product?.name || t('deliveries.modal.noProduct')}`;
        if (r.type === 'payment') return `${t('customers.detail.ledger.payment')} (${t(`paymentModes.${r.payment.payment_mode}`)})`;
        return `${t('customers.detail.ledger.creditNote')}${r.creditNote.reason ? ` — ${r.creditNote.reason}` : ''}`;
      },
      hideInCard: false,
    },
    {
      key: 'amount',
      header: t('customers.detail.amount'),
      render: (r) => {
        if (r.type === 'opening') return formatCurrency(r.netEffect);
        if (r.type === 'credit_balance') return `-${formatCurrency(r.netEffect * -1)}`;
        if (r.type === 'delivery') return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {formatCurrency(r.delivery.total_amount)}
            <Badge tone={PAYMENT_STATUS_TONE[r.delivery.payment_status]}>{t(`badges.${r.delivery.payment_status}`)}</Badge>
          </span>
        );
        if (r.type === 'payment') return `${formatCurrency(r.payment.amount)} (${t('customers.detail.ledger.appliedNote')})`;
        return `-${formatCurrency(r.creditNote.amount)}`;
      },
    },
    {
      key: 'balance',
      header: t('customers.detail.ledger.runningBalance'),
      render: (r) => <strong>{r.balanceAfter < 0 ? `-${formatCurrency(Math.abs(r.balanceAfter))}` : formatCurrency(r.balanceAfter)}</strong>,
    },
  ];

  const paymentColumns = [
    { key: 'payment_date', header: t('customers.detail.paymentColumns.date'), render: (r) => formatDate(r.payment_date) },
    { key: 'amount', header: t('customers.detail.paymentColumns.amount'), render: (r) => formatCurrency(r.amount) },
    { key: 'payment_mode', header: t('customers.detail.paymentColumns.mode'), render: (r) => t(`paymentModes.${r.payment_mode}`) },
    ...(vehicleOrg ? [{ key: 'vehicle', header: t('payments.columns.vehicle'), render: (r) => r.vehicle?.vehicle_number || t('payments.office') }] : []),
    { key: 'notes', header: t('customers.detail.paymentColumns.notes'), render: (r) => r.notes || '—' },
  ];

  const depositColumns = [
    { key: 'deposit_date', header: t('deliveries.filters.from'), render: (r) => formatDate(r.deposit_date) },
    { key: 'item_name', header: t('deposits.columns.item') },
    { key: 'quantity_deposited', header: t('deposits.columns.quantity') },
    { key: 'total_deposit', header: t('deposits.columns.total'), render: (r) => formatCurrency(r.total_deposit) },
    { key: 'returned_amount', header: t('deposits.columns.returned'), render: (r) => formatCurrency(r.returned_amount) },
    { key: 'status', header: t('common.status'), render: (r) => <Badge tone={DEPOSIT_STATUS_TONE[r.status]}>{t(`deposits.status.${r.status}`)}</Badge> },
    {
      key: 'actions',
      header: t('deliveries.columns.actions'),
      render: (r) => r.status !== 'fully_returned' && <Button variant="ghost" onClick={() => openReturn(r)}>{t('deposits.recordReturn')}</Button>,
    },
  ];

  const creditNoteColumns = [
    { key: 'issued_at', header: t('deliveries.filters.from'), render: (r) => formatDate(r.issued_at) },
    { key: 'amount', header: t('customers.detail.paymentColumns.amount'), render: (r) => formatCurrency(r.amount) },
    { key: 'reason', header: t('creditNotes.reason'), render: (r) => r.reason || '—' },
    { key: 'issued_by', header: t('deliveries.columns.staff'), render: (r) => r.issued_by_user?.name || '—' },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (r.voided_at ? <Badge tone="neutral">{t('creditNotes.voided')}</Badge> : <Badge tone="success">{t('common.active')}</Badge>),
    },
    {
      key: 'actions',
      header: t('deliveries.columns.actions'),
      render: (r) => !r.voided_at && <Button variant="ghost" onClick={() => setVoidTargetId(r.id)}>{t('creditNotes.void')}</Button>,
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <Link to="/admin/customers" className="mutedText">{t('common.backTo', { page: t('customers.title') })}</Link>
          <h1>{customer.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => setShowDelivery(true)}>{t('customers.detail.recordDelivery')}</Button>
          <Button onClick={() => setShowPayment(true)}>{t('customers.detail.recordPayment')}</Button>
          {customer.phone && (
            <Button
              variant="secondary"
              onClick={() => window.open(`https://wa.me/${customer.phone.replace(/\D/g, '')}`, '_blank', 'noopener')}
            >
              {t('customers.detail.whatsapp')}
            </Button>
          )}
          {customer.phone && (
            <Button variant="secondary" onClick={() => { window.location.href = `tel:${customer.phone}`; }}>
              {t('customers.detail.call')}
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <IconButton icon="edit" label={t('customers.detail.editCustomer')} onClick={startEdit} />
        <Button variant="ghost" onClick={openDeposit}>{t('deposits.addDeposit')}</Button>
        <Button variant="ghost" onClick={openCreditNote}>{t('creditNotes.addCreditNote')}</Button>
        <Button variant="ghost" onClick={openWalletTopup}>{t('customers.detail.topUpWallet')}</Button>
        {customer.phone && total_due > 0 && (
          <Button variant="ghost" onClick={handleSendReminder}>{t('customers.detail.sendReminder')}</Button>
        )}
        {customer.phone && (
          <Button variant="ghost" onClick={handleSendMonthlyStatement}>{t('customers.detail.monthlyStatement')}</Button>
        )}
        <Button variant="ghost" disabled={portalLinkBusy} onClick={handleGetPortalLink}>{t('customers.detail.shareableLink')}</Button>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div>
          <div className="mutedText">{t('common.phone')}</div>
          <div>{customer.phone || '—'}</div>
        </div>
        {vehicleOrg ? (
          <div>
            <div className="mutedText">{t('customers.detail.assignedVehicle')}</div>
            <div>{customer.assigned_vehicle?.vehicle_number || '—'}</div>
          </div>
        ) : (
          <div>
            <div className="mutedText">{t('customers.detail.assignedStaff')}</div>
            <div>{customer.assigned_staff?.name || '—'}</div>
          </div>
        )}
        {parseFloat(customer.opening_balance) > 0 && (
          <div>
            <div className="mutedText">{t('customers.detail.openingBalance')}</div>
            <div>{formatCurrency(customer.opening_balance)}</div>
          </div>
        )}
        {parseFloat(customer.credit_balance) > 0 && (
          <div>
            <div className="mutedText">{t('customers.detail.creditBalance')}</div>
            <div>{formatCurrency(customer.credit_balance)}</div>
          </div>
        )}
        <div>
          <div className="mutedText">{t('customers.detail.totalDue')}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: total_due > 0 ? 700 : 400, color: total_due > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
            {formatCurrency(total_due)}
          </div>
        </div>
      </div>

      <div className="pageHeader">
        <h2 style={{ margin: 0 }}>{t('customers.detail.ledger.title')}</h2>
        <span className="mutedText">{overdueCount === 0 ? t('customers.detail.ledger.paysOnTime') : t('customers.detail.ledger.hasOverdue', { count: overdueCount })}</span>
      </div>
      <div className="card" style={{ marginBottom: 24 }}>
        <Table columns={ledgerColumns} rows={ledger} rowKey={(r) => r.key} emptyMessage={t('customers.detail.noDeliveries')} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <CustomerOrders customerId={id} refreshKey={data} />
      </div>

      <h2>{t('customers.detail.paymentHistory')}</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <Table columns={paymentColumns} rows={payments} rowKey={(r) => r.id} emptyMessage={t('customers.detail.noPayments')} />
      </div>

      <h2>{t('deposits.title')}</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <Table columns={depositColumns} rows={deposits} rowKey={(r) => r.id} emptyMessage={t('deposits.empty')} />
      </div>

      <h2>{t('creditNotes.title')}</h2>
      <div className="card">
        <Table columns={creditNoteColumns} rows={creditNotes} rowKey={(r) => r.id} emptyMessage={t('creditNotes.empty')} />
      </div>

      {showDelivery && (
        <DeliveryEntryModal
          customer={customer}
          onClose={() => setShowDelivery(false)}
          onSaved={() => load()}
        />
      )}

      {showPayment && (
        <RecordPaymentModal
          customerId={id}
          customerName={customer.name}
          onClose={() => setShowPayment(false)}
          onRecorded={() => load()}
        />
      )}

      {editing && (
        <Modal title={t('customers.detail.editCustomer')} onClose={() => setEditing(false)}>
          <form onSubmit={handleSaveEdit}>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <TextInput label={t('common.phone')} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              <TextInput label={t('customers.modal.defaultQuantity')} type="number" inputMode="decimal" step="0.01" value={editForm.default_quantity} onChange={(e) => setEditForm({ ...editForm, default_quantity: e.target.value })} />
              <TextInput label={t('customers.modal.customPrice')} type="number" inputMode="decimal" step="0.01" value={editForm.custom_price_per_unit} onChange={(e) => setEditForm({ ...editForm, custom_price_per_unit: e.target.value })} />
              <TextInput label={t('customers.modal.openingBalance')} type="number" inputMode="decimal" step="0.01" min="0" value={editForm.opening_balance} onChange={(e) => setEditForm({ ...editForm, opening_balance: e.target.value })} />
              <Select label={t('customers.modal.preferredLanguage')} value={editForm.preferred_language} onChange={(e) => setEditForm({ ...editForm, preferred_language: e.target.value })}>
                <option value="">{t('customers.modal.useOrgDefault')}</option>
                {SUPPORTED_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
              </Select>
            </div>
            <TextInput label={t('common.address')} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} style={{ marginTop: 16 }} />
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showDeposit && (
        <Modal title={`${t('deposits.addDeposit')} — ${customer.name}`} onClose={() => setShowDeposit(false)}>
          <form onSubmit={handleCreateDeposit}>
            <div className="formGrid">
              <TextInput label={t('deposits.columns.item')} required placeholder={t('deposits.itemPlaceholder')} value={depositForm.item_name} onChange={(e) => setDepositForm({ ...depositForm, item_name: e.target.value })} />
              <TextInput label={t('deposits.columns.quantity')} type="number" inputMode="decimal" step="0.01" min="0.01" value={depositForm.quantity_deposited} onChange={(e) => setDepositForm({ ...depositForm, quantity_deposited: e.target.value })} />
              <TextInput label={t('deposits.amountPerItem')} type="number" inputMode="decimal" step="0.01" min="0" required value={depositForm.deposit_amount_per_item} onChange={(e) => setDepositForm({ ...depositForm, deposit_amount_per_item: e.target.value })} />
            </div>
            {depositError && <p className="errorText">{depositError}</p>}
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowDeposit(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {returnTarget && (
        <Modal title={`${t('deposits.recordReturn')} — ${returnTarget.item_name}`} onClose={() => setReturnTarget(null)}>
          <form onSubmit={handleRecordReturn}>
            <p className="mutedText" style={{ marginTop: 0 }}>
              {t('deposits.columns.total')}: {formatCurrency(returnTarget.total_deposit)} · {t('deposits.columns.returned')}: {formatCurrency(returnTarget.returned_amount)}
            </p>
            <TextInput label={t('deposits.returnAmount')} type="number" inputMode="decimal" step="0.01" min="0.01" required value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)} />
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setReturnTarget(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showCreditNote && (
        <Modal title={`${t('creditNotes.addCreditNote')} — ${customer.name}`} onClose={() => setShowCreditNote(false)}>
          <form onSubmit={handleCreateCreditNote}>
            <TextInput label={t('customers.detail.amount')} type="number" inputMode="decimal" step="0.01" min="0.01" required value={creditNoteForm.amount} onChange={(e) => setCreditNoteForm({ ...creditNoteForm, amount: e.target.value })} />
            <TextInput label={t('creditNotes.reason')} value={creditNoteForm.reason} onChange={(e) => setCreditNoteForm({ ...creditNoteForm, reason: e.target.value })} style={{ marginTop: 16 }} />
            <p className="mutedText" style={{ marginTop: 12 }}>{t('creditNotes.hint')}</p>
            {creditNoteError && <p className="errorText">{creditNoteError}</p>}
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreditNote(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showWalletTopup && (
        <Modal title={`${t('customers.detail.topUpWallet')} — ${customer.name}`} onClose={() => setShowWalletTopup(false)}>
          <form onSubmit={handleWalletTopup}>
            <p className="mutedText" style={{ marginTop: 0 }}>{t('customers.detail.walletTopupHint')}</p>
            <div className="formGrid">
              <TextInput label={t('customers.detail.amount')} type="number" inputMode="decimal" step="0.01" min="0.01" required value={walletTopupForm.amount} onChange={(e) => setWalletTopupForm({ ...walletTopupForm, amount: e.target.value })} />
              <Select label={t('deliveries.modal.paymentMode')} value={walletTopupForm.payment_mode} onChange={(e) => setWalletTopupForm({ ...walletTopupForm, payment_mode: e.target.value })}>
                <option value="cash">{t('deliveries.modal.cash')}</option>
                <option value="upi">{t('deliveries.modal.upi')}</option>
                <option value="bank_transfer">{t('deliveries.modal.bankTransfer')}</option>
                <option value="card">{t('deliveries.modal.card')}</option>
                <option value="other">{t('deliveries.modal.other')}</option>
              </Select>
            </div>
            <TextInput label={t('customers.detail.paymentNotes')} value={walletTopupForm.notes} onChange={(e) => setWalletTopupForm({ ...walletTopupForm, notes: e.target.value })} style={{ marginTop: 16 }} />
            {walletTopupError && <p className="errorText">{walletTopupError}</p>}
            <div className="formActions">
              <Button type="submit" disabled={walletTopupSaving}>{walletTopupSaving ? t('common.saving') : t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowWalletTopup(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {voidTargetId && (
        <ConfirmDialog
          message={t('customers.detail.voidConfirm')}
          confirmLabel={t('creditNotes.void')}
          danger
          onConfirm={confirmVoidCreditNote}
          onCancel={() => setVoidTargetId(null)}
        />
      )}
    </div>
  );
}
