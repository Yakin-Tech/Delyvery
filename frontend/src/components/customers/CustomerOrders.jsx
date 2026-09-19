import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listCustomerOrders } from '../../api/customers.api';
import { listProducts } from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Pagination from '../common/Pagination';
import Select from '../common/Select';
import Spinner from '../common/Spinner';
import StatCard, { StatGrid } from '../common/StatCard';
import Table from '../common/Table';
import TextInput from '../common/TextInput';
import { PAYMENT_STATUS_TONE, formatCurrency, formatDate } from '../../utils/paymentStatus';
import { unitLabel } from '../../utils/businessTypes';
import styles from './CustomerOrders.module.css';

const emptyFilters = { payment_status: '', date_from: '', date_to: '', product_id: '' };

// Every order this customer has ever placed — the full history, newest first —
// with filters (status, dates, product), totals for what's filtered, and paging.
// Shared by the org admin's and the office staff's customer pages.
export default function CustomerOrders({ customerId, refreshKey = 0 }) {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const showProductFilter = Boolean(organization?.products_enabled);

  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    if (!showProductFilter) return;
    listProducts({ page_size: 100 }).then((r) => setProducts(r.data)).catch(() => setProducts([]));
  }, [showProductFilter]);

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    setLoading(true);
    try {
      const next = await listCustomerOrders(customerId, { ...filters, page, page_size: pageSize });
      if (mine !== requestId.current) return;
      setResult(next);
      setError('');
    } catch (err) {
      if (mine === requestId.current) setError(err.message);
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [customerId, filters, page, pageSize]);

  useEffect(() => { load(); }, [load, refreshKey]);

  function changeFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  }

  const filtered = Object.values(filters).some(Boolean);
  const totals = result?.totals;
  const rows = result?.data || [];

  const columns = [
    { key: 'delivery_date', header: t('deliveries.columns.date'), render: (r) => formatDate(r.delivery_date) },
    { key: 'product', header: t('common.product'), render: (r) => r.product?.name || '—' },
    {
      key: 'quantity',
      header: t('deliveries.columns.qty'),
      render: (r) => `${r.quantity} ${unitLabel(r.product?.unit_of_measure || organization?.unit_of_measure || 'litre', t)}`,
    },
    { key: 'total_amount', header: t('deliveries.columns.amount'), render: (r) => formatCurrency(r.total_amount) },
    { key: 'amount_paid', header: t('deliveries.columns.paid'), render: (r) => formatCurrency(r.amount_paid) },
    {
      key: 'pending',
      header: t('customers.columns.pending'),
      render: (r) => {
        const pending = Math.max(parseFloat(r.total_amount) - parseFloat(r.amount_paid), 0);
        return pending > 0 ? <strong className={styles.pending}>{formatCurrency(pending)}</strong> : '—';
      },
    },
    { key: 'payment_status', header: t('deliveries.columns.status'), render: (r) => <Badge tone={PAYMENT_STATUS_TONE[r.payment_status]}>{t(`badges.${r.payment_status}`)}</Badge> },
    ...(vehicleOrg ? [{ key: 'vehicle', header: t('deliveries.columns.vehicle'), render: (r) => r.vehicle?.vehicle_number || '—' }] : []),
    { key: 'staff', header: vehicleOrg ? t('deliveries.columns.enteredBy') : t('deliveries.columns.staff'), render: (r) => r.staff?.name || '—' },
    { key: 'notes', header: t('common.notes'), render: (r) => [r.place, r.notes].filter(Boolean).join(' · ') || '—' },
  ];

  return (
    <section aria-label={t('customerOrders.title')}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('customerOrders.title')}</h2>
        {totals && <span className="mutedText">{t('customerOrders.count', { count: totals.orders_count })}</span>}
      </div>

      {totals && (
        <StatGrid>
          <StatCard label={t('deliveries.summary.totalValue')} value={formatCurrency(totals.total_value)} />
          <StatCard label={t('deliveries.summary.totalCollected')} value={formatCurrency(totals.total_collected)} />
          <StatCard label={t('deliveries.summary.totalPending')} value={formatCurrency(totals.total_pending)} />
        </StatGrid>
      )}

      <div className={`card ${styles.filters}`}>
        <Select label={t('deliveries.filters.paymentStatus')} value={filters.payment_status} onChange={(e) => changeFilter('payment_status', e.target.value)}>
          <option value="">{t('deliveries.filters.allStatuses')}</option>
          <option value="paid">{t('deliveries.filters.paid')}</option>
          <option value="partial">{t('deliveries.filters.partial')}</option>
          <option value="pending">{t('deliveries.filters.pending')}</option>
        </Select>
        {showProductFilter && products.length > 0 && (
          <Select label={t('common.product')} value={filters.product_id} onChange={(e) => changeFilter('product_id', e.target.value)}>
            <option value="">{t('deliveries.filters.allProducts')}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <TextInput label={t('deliveries.filters.from')} type="date" value={filters.date_from} onChange={(e) => changeFilter('date_from', e.target.value)} />
        <TextInput label={t('deliveries.filters.to')} type="date" value={filters.date_to} onChange={(e) => changeFilter('date_to', e.target.value)} />
        {filtered && (
          <Button type="button" variant="ghost" className={styles.clear} onClick={() => { setFilters(emptyFilters); setPage(1); }}>
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      <div className="card">
        {error && <p className="errorText">{error}</p>}
        {loading && !result ? <Spinner /> : (
          <div className={loading ? styles.reloading : undefined}>
            <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyMessage={filtered ? t('customerOrders.emptyFiltered') : t('customerOrders.empty')} />
            <Pagination
              pagination={result?.pagination}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
