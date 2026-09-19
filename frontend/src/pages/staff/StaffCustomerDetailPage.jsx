import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getCustomer } from '../../api/customers.api';
import Button from '../../components/common/Button';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import CustomerOrders from '../../components/customers/CustomerOrders';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import { formatCurrency, formatDate } from '../../utils/paymentStatus';

const PAYMENT_ROWS_SHOWN = 10;
const daysSince = (dateStr) => Math.max(Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000)), 0);

// One customer for office staff: what they owe and how it's made up, the
// deliveries still unpaid (each with its own balance), every order they have
// ever placed, and their payment history — with a Record payment button right there.
export default function StaffCustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);

  async function load() {
    try {
      setData(await getCustomer(id));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setLoading(true); setShowAllPayments(false); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingDeliveries = useMemo(() => {
    if (!data) return [];
    return data.deliveries
      .map((d) => ({ ...d, pending_amount: Math.max(parseFloat(d.total_amount) - parseFloat(d.amount_paid), 0) }))
      .filter((d) => d.payment_status !== 'paid' && d.pending_amount > 0)
      .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
  }, [data]);

  if (loading) return <div className="page"><Spinner /></div>;
  if (error || !data) {
    return (
      <div className="page">
        <Link to="/staff/customers">{t('common.backTo', { page: t('nav.customers') })}</Link>
        <p className="errorText">{error || t('staffCustomers.notFound')}</p>
      </div>
    );
  }

  const { customer, payments, credit_notes: creditNotes, total_due: totalDue } = data;
  const deliveryDue = pendingDeliveries.reduce((sum, d) => sum + d.pending_amount, 0);
  const openingBalance = parseFloat(customer.opening_balance) || 0;
  const creditBalance = parseFloat(customer.credit_balance) || 0;
  const creditNotesTotal = creditNotes.filter((n) => !n.voided_at).reduce((sum, n) => sum + parseFloat(n.amount), 0);

  const pendingColumns = [
    { key: 'delivery_date', header: t('staffCustomers.detail.date'), render: (r) => formatDate(r.delivery_date) },
    { key: 'vehicle', header: t('staffCustomers.detail.vehicle'), render: (r) => r.vehicle?.vehicle_number || '—' },
    { key: 'product', header: t('staffCustomers.detail.product'), render: (r) => r.product?.name || '—' },
    { key: 'quantity', header: t('staffCustomers.detail.qty') },
    { key: 'total_amount', header: t('staffCustomers.detail.total'), render: (r) => formatCurrency(r.total_amount) },
    { key: 'amount_paid', header: t('staffCustomers.detail.paid'), render: (r) => formatCurrency(r.amount_paid) },
    { key: 'pending_amount', header: t('staffCustomers.detail.pending'), render: (r) => <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(r.pending_amount)}</strong> },
    { key: 'age', header: t('staffCustomers.detail.age'), render: (r) => t('staffCustomers.detail.daysOld', { count: daysSince(r.delivery_date) }) },
  ];

  const paymentColumns = [
    { key: 'payment_date', header: t('staffCustomers.detail.date'), render: (r) => formatDate(r.payment_date) },
    { key: 'amount', header: t('staffCustomers.detail.amount'), render: (r) => <strong>{formatCurrency(r.amount)}</strong> },
    { key: 'payment_mode', header: t('staffCustomers.detail.mode'), render: (r) => t(`paymentModes.${r.payment_mode}`) },
    { key: 'vehicle', header: t('staffCustomers.detail.collectedBy'), render: (r) => r.vehicle?.vehicle_number || t('staffCustomers.detail.office') },
    { key: 'recorded_by_user', header: t('staffCustomers.detail.recordedBy'), render: (r) => r.recorded_by_user?.name || '—' },
    { key: 'notes', header: t('common.notes'), render: (r) => (r.is_wallet_topup ? t('staffCustomers.detail.walletTopup') : (r.notes || '—')) },
  ];

  const shownPayments = showAllPayments ? payments : payments.slice(0, PAYMENT_ROWS_SHOWN);

  return (
    <div className="page">
      <Link to="/staff/customers">{t('common.backTo', { page: t('nav.customers') })}</Link>
      <div className="pageHeader" style={{ marginTop: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{customer.name}</h1>
          <div className="mutedText">
            {customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : t('staffCustomers.detail.noPhone')}
            {customer.address ? ` · ${customer.address}` : ''}
            {customer.assigned_vehicle ? <> · <Badge tone="neutral">{customer.assigned_vehicle.vehicle_number}</Badge></> : null}
            {customer.status !== 'active' ? <> · <Badge tone="neutral">{t('common.inactive')}</Badge></> : null}
          </div>
        </div>
        <Button onClick={() => setShowPayment(true)}>{t('staffCustomers.recordPayment')}</Button>
      </div>

      <StatGrid>
        <StatCard label={t('staffCustomers.detail.totalDue')} value={<span style={{ color: totalDue > 0 ? 'var(--color-danger)' : undefined }}>{formatCurrency(totalDue)}</span>} />
        <StatCard label={t('staffCustomers.detail.pendingOnDeliveries')} value={formatCurrency(deliveryDue)} />
        {openingBalance > 0 && <StatCard label={t('staffCustomers.detail.openingBalance')} value={formatCurrency(openingBalance)} />}
        {creditNotesTotal > 0 && <StatCard label={t('staffCustomers.detail.creditNotes')} value={formatCurrency(creditNotesTotal)} />}
        {creditBalance > 0 && <StatCard label={t('staffCustomers.detail.creditBalance')} value={formatCurrency(creditBalance)} />}
      </StatGrid>

      <h2 style={{ marginTop: 24 }}>{t('staffCustomers.detail.pendingDeliveries')}</h2>
      <div className="card">
        <Table columns={pendingColumns} rows={pendingDeliveries} rowKey={(r) => r.id} emptyMessage={t('staffCustomers.detail.noPendingDeliveries')} />
      </div>

      <div style={{ marginTop: 24 }}>
        <CustomerOrders customerId={customer.id} refreshKey={data} />
      </div>

      <h2 style={{ marginTop: 24 }}>{t('staffCustomers.detail.paymentHistory')}</h2>
      <div className="card">
        <Table columns={paymentColumns} rows={shownPayments} rowKey={(r) => r.id} emptyMessage={t('staffCustomers.detail.noPayments')} />
        {payments.length > PAYMENT_ROWS_SHOWN && (
          <Button type="button" variant="ghost" onClick={() => setShowAllPayments((v) => !v)} style={{ marginTop: 8 }}>
            {showAllPayments ? t('common.showFewer') : t('common.showAll', { count: payments.length })}
          </Button>
        )}
      </div>

      {showPayment && (
        <RecordPaymentModal
          customerId={customer.id}
          customerName={customer.name}
          onClose={() => setShowPayment(false)}
          onRecorded={() => load()}
        />
      )}
    </div>
  );
}
