import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listDeliveries, deleteDelivery } from '../../api/deliveries.api';
import { listStaff } from '../../api/staff.api';
import { listVehicles } from '../../api/vehicles.api';
import { listProducts } from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/common/Button';
import IconButton, { RowActions } from '../../components/common/IconButton';
import Select from '../../components/common/Select';
import TextInput from '../../components/common/TextInput';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Toast from '../../components/common/Toast';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import DeliveryEntryModal from '../../components/deliveries/DeliveryEntryModal';
import { PAYMENT_STATUS_TONE, formatCurrency, formatDate } from '../../utils/paymentStatus';
import useDelayedAction from '../../hooks/useDelayedAction';
import styles from './DeliveriesPage.module.css';

const emptyFilters = { staff_id: '', vehicle_id: '', payment_status: '', date_from: '', date_to: '', product_id: '' };

export default function DeliveriesPage() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const [deliveries, setDeliveries] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [totals, setTotals] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [staffOptions, setStaffOptions] = useState([]);
  const [vehicleOptions, setVehicleOptions] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [editTarget, setEditTarget] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null);
  const { pending: pendingDelete, schedule: scheduleDelete, undo: undoDelete } = useDelayedAction(6000);
  const searchDebounceRef = useRef(null);

  async function load(currentFilters, searchTerm, pageNum, size = pageSize) {
    setLoading(true);
    try {
      const result = await listDeliveries({ ...currentFilters, search: searchTerm, page: pageNum, page_size: size });
      setDeliveries(result.data);
      setPagination(result.pagination);
      setTotals(result.totals);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(filters, search, 1);
    listStaff({ page_size: 100 }).then((r) => setStaffOptions(r.data));
    if (vehicleOrg) listVehicles({ page_size: 100 }).then((r) => setVehicleOptions(r.data));
    if (organization?.products_enabled) listProducts({ page_size: 100 }).then((r) => setProducts(r.data));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The mobile FAB (AppLayout.jsx) links here with ?new=1 to jump straight
  // into the add-delivery flow instead of landing on the list first.
  useEffect(() => {
    if (searchParams.get('new')) {
      setShowCreate(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function handleFilterChange(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    setPage(1);
    load(next, search, 1);
  }

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearch(value);
    setPage(1);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => load(filters, value, 1), 300);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setSearch('');
    setPage(1);
    load(emptyFilters, '', 1);
  }

  function handlePageChange(nextPage) {
    setPage(nextPage);
    load(filters, search, nextPage);
  }

  function handlePageSizeChange(nextSize) {
    setPageSize(nextSize);
    setPage(1);
    load(filters, search, 1, nextSize);
  }

  // The row disappears from view the moment the admin confirms — matching
  // "never delete anything visibly" — but the actual API call is held behind
  // an Undo window (see useDelayedAction) instead of firing right away, so a
  // mis-tap is still recoverable.
  function confirmDelete() {
    const delivery = confirmDeleteTarget;
    setConfirmDeleteTarget(null);
    setDeliveries((prev) => prev.filter((d) => d.id !== delivery.id));
    scheduleDelete(
      delivery.id,
      async () => {
        try {
          await deleteDelivery(delivery.id);
        } finally {
          await load(filters, search, page);
        }
      },
      () => setDeliveries((prev) => (prev.some((d) => d.id === delivery.id) ? prev : [delivery, ...prev])),
    );
  }

  const columns = [
    { key: 'delivery_date', header: t('deliveries.columns.date'), render: (r) => formatDate(r.delivery_date) },
    { key: 'customer', header: t('deliveries.columns.customer'), render: (r) => (r.customer ? <Link to={`/admin/customers/${r.customer.id}`}>{r.customer.name}</Link> : '—') },
    { key: 'product', header: t('common.product'), render: (r) => r.product?.name || '—' },
    { key: 'place', header: t('common.place'), render: (r) => r.place || '—' },
    ...(vehicleOrg ? [{ key: 'vehicle', header: t('deliveries.columns.vehicle'), render: (r) => r.vehicle?.vehicle_number || '—' }] : []),
    { key: 'staff', header: vehicleOrg ? t('deliveries.columns.enteredBy') : t('deliveries.columns.staff'), render: (r) => r.staff?.name || '—' },
    { key: 'quantity', header: t('deliveries.columns.qty') },
    { key: 'total_amount', header: t('deliveries.columns.amount'), render: (r) => formatCurrency(r.total_amount) },
    { key: 'amount_paid', header: t('deliveries.columns.paid'), render: (r) => formatCurrency(r.amount_paid) },
    { key: 'payment_status', header: t('deliveries.columns.status'), render: (r) => <Badge tone={PAYMENT_STATUS_TONE[r.payment_status]}>{t(`badges.${r.payment_status}`)}</Badge> },
    {
      key: 'actions',
      header: t('deliveries.columns.actions'),
      render: (r) => (
        <RowActions>
          <IconButton icon="edit" label={t('common.edit')} disabled={pendingDelete?.id === r.id} onClick={() => setEditTarget(r)} />
          <IconButton icon="delete" label={t('common.delete')} disabled={pendingDelete?.id === r.id} onClick={() => setConfirmDeleteTarget(r)} />
        </RowActions>
      ),
    },
  ];

  const anyFilter = Boolean(search) || Object.values(filters).some(Boolean);
  const showProductFilter = Boolean(organization?.products_enabled) && products.length > 0;

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('deliveries.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('deliveries.addDelivery')}</Button>
      </div>

      {totals && (
        <StatGrid>
          <StatCard label={t('deliveries.summary.totalValue')} value={formatCurrency(totals.total_value)} />
          <StatCard label={t('deliveries.summary.totalCollected')} value={formatCurrency(totals.total_collected)} />
          <StatCard label={t('deliveries.summary.totalPending')} value={formatCurrency(totals.total_pending)} />
        </StatGrid>
      )}

      <div className={`card ${styles.filters}`}>
        <div className={styles.filtersHeader}>
          <span className={styles.filtersTitle}>{t('deliveries.filters.title')}</span>
          {anyFilter && <button type="button" className={styles.clear} onClick={clearFilters}>{t('common.clearFilters')}</button>}
        </div>
        <div className={styles.grid}>
          <div className={styles.search}>
            <TextInput aria-label={t('deliveries.filters.searchPlaceholder')} placeholder={t('deliveries.filters.searchPlaceholder')} value={search} onChange={handleSearchChange} />
          </div>
          {vehicleOrg && (
            <Select label={t('deliveries.filters.vehicle')} value={filters.vehicle_id} onChange={(e) => handleFilterChange('vehicle_id', e.target.value)}>
              <option value="">{t('deliveries.filters.allVehicles')}</option>
              {vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)}
            </Select>
          )}
          <Select label={vehicleOrg ? t('deliveries.filters.enteredBy') : t('deliveries.filters.staff')} value={filters.staff_id} onChange={(e) => handleFilterChange('staff_id', e.target.value)}>
            <option value="">{t('deliveries.filters.allStaff')}</option>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select label={t('deliveries.filters.paymentStatus')} value={filters.payment_status} onChange={(e) => handleFilterChange('payment_status', e.target.value)}>
            <option value="">{t('deliveries.filters.allStatuses')}</option>
            <option value="paid">{t('deliveries.filters.paid')}</option>
            <option value="partial">{t('deliveries.filters.partial')}</option>
            <option value="pending">{t('deliveries.filters.pending')}</option>
          </Select>
          {showProductFilter && (
            <Select label={t('common.product')} value={filters.product_id} onChange={(e) => handleFilterChange('product_id', e.target.value)}>
              <option value="">{t('deliveries.filters.allProducts')}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          <TextInput label={t('deliveries.filters.from')} type="date" value={filters.date_from} onChange={(e) => handleFilterChange('date_from', e.target.value)} />
          <TextInput label={t('deliveries.filters.to')} type="date" value={filters.date_to} onChange={(e) => handleFilterChange('date_to', e.target.value)} />
        </div>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={deliveries} rowKey={(r) => r.id} emptyMessage={t('deliveries.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {(showCreate || editTarget) && (
        <DeliveryEntryModal
          delivery={editTarget}
          onClose={() => { setShowCreate(false); setEditTarget(null); }}
          onSaved={() => load(filters, search, editTarget ? page : 1)}
        />
      )}

      {confirmDeleteTarget && (
        <ConfirmDialog
          message={t('deliveries.modal.deleteConfirm')}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteTarget(null)}
        />
      )}

      {pendingDelete && (
        <Toast
          message={t('deliveries.modal.deletePendingMessage')}
          actionLabel={t('common.undo')}
          onAction={undoDelete}
        />
      )}
    </div>
  );
}
