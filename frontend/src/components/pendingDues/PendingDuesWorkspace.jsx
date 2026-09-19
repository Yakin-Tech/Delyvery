import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  listPendingDues, listPendingDeliveries, fetchVehiclePendingSummary, fetchStaffPendingSummary, exportPendingDuesCsv,
} from '../../api/pendingDues.api';
import { listVehicles } from '../../api/vehicles.api';
import { listStaff } from '../../api/staff.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../common/Button';
import TextInput from '../common/TextInput';
import Select from '../common/Select';
import Table from '../common/Table';
import Tabs from '../common/Tabs';
import Badge from '../common/Badge';
import Spinner from '../common/Spinner';
import Pagination from '../common/Pagination';
import StatCard, { StatGrid } from '../common/StatCard';
import RecordPaymentModal from '../payments/RecordPaymentModal';
import { PAYMENT_STATUS_TONE, formatCurrency, formatDate } from '../../utils/paymentStatus';
import styles from './PendingDuesWorkspace.module.css';

const AGE_OPTIONS = [7, 15, 30, 90, 180];
const owed = { color: 'var(--color-danger)' };

// Who owes what, three ways — the same view for the org admin and for office staff:
//   by customer  — each customer's total due (opening balance, credit and all)
//   by delivery  — every open delivery on its own row with what is left on it
//   by vehicle   — pending per vehicle (or per staff member in a route_staff org),
//                  with a jump into that vehicle's / staff member's customers
// Every row that has a customer can record a payment on the spot.
// `basePath` is where customer links go ('/admin' or '/staff'); `canExport` adds
// the CSV export (admin only).
export default function PendingDuesWorkspace({ basePath, canExport = false }) {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const groupTab = vehicleOrg ? 'vehicles' : 'staff';
  const defaultSort = canExport ? 'amount' : 'oldest';

  const [tab, setTab] = useState('customers');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [totals, setTotals] = useState(null);
  const [groupSummary, setGroupSummary] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [staff, setStaff] = useState([]);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ vehicle_id: '', staff_id: '', min_age_days: '', sort: defaultSort });
  const [paymentTarget, setPaymentTarget] = useState(null);
  const debounceRef = useRef(null);
  const requestRef = useRef(0);

  async function load(activeTab, searchTerm, currentFilters, pageNum, size) {
    const requestId = (requestRef.current += 1);
    setLoading(true);
    setError('');
    try {
      if (activeTab === groupTab) {
        const summary = await (vehicleOrg ? fetchVehiclePendingSummary() : fetchStaffPendingSummary());
        if (requestId !== requestRef.current) return;
        setGroupSummary(summary);
        return;
      }
      const params = { ...currentFilters, search: searchTerm, page: pageNum, page_size: size };
      const result = activeTab === 'customers' ? await listPendingDues(params) : await listPendingDeliveries(params);
      if (requestId !== requestRef.current) return;
      setRows(result.data);
      setPagination(result.pagination);
      setTotals(result.totals);
    } catch (err) {
      if (requestId === requestRef.current) setError(err.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load('customers', '', filters, 1, pageSize);
    if (vehicleOrg) listVehicles({ page_size: 100 }).then((r) => setVehicles(r.data)).catch(() => setVehicles([]));
    else if (canExport) listStaff({ page_size: 100 }).then((r) => setStaff(r.data)).catch(() => setStaff([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchTab(next, nextFilters = filters) {
    setTab(next);
    setRows([]);
    setPagination(null);
    setTotals(null);
    load(next, search, nextFilters, 1, pageSize);
  }

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(tab, value, filters, 1, pageSize), 300);
  }

  function handleFilterChange(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    load(tab, search, next, 1, pageSize);
  }

  // Jump from a vehicle's (or staff member's) row to that group's customers.
  function viewCustomersOf(field, value) {
    const next = { ...filters, vehicle_id: '', staff_id: '', [field]: value };
    setFilters(next);
    switchTab('customers', next);
  }

  function reload() {
    load(tab, search, filters, pagination?.page || 1, pageSize);
  }

  const recordButton = (customer) => (
    <Button type="button" variant="secondary" onClick={() => setPaymentTarget({ id: customer.id, name: customer.name })}>
      {t('duesView.recordPayment')}
    </Button>
  );
  const customerLink = (customer) => <Link to={`${basePath}/customers/${customer.id}`}><strong>{customer.name}</strong></Link>;

  const groupColumn = vehicleOrg
    ? (r) => (r.customer.assigned_vehicle ? <Badge tone="neutral">{r.customer.assigned_vehicle.vehicle_number}</Badge> : '—')
    : (r) => r.customer.assigned_staff?.name || '—';

  const customerColumns = [
    { key: 'customer', header: t('duesView.columns.customer'), render: (r) => customerLink(r.customer) },
    { key: 'phone', header: t('duesView.columns.phone'), render: (r) => (r.customer.phone ? <a href={`tel:${r.customer.phone}`}>{r.customer.phone}</a> : '—') },
    { key: 'group', header: vehicleOrg ? t('duesView.columns.vehicle') : t('duesView.columns.staff'), render: groupColumn },
    { key: 'total_due', header: t('duesView.columns.totalDue'), render: (r) => <strong style={owed}>{formatCurrency(r.total_due)}</strong> },
    { key: 'oldest', header: t('duesView.columns.oldest'), render: (r) => formatDate(r.oldest_unpaid_date) },
    { key: 'days', header: t('duesView.columns.days'), render: (r) => r.days_pending },
    { key: 'last_payment', header: t('duesView.columns.lastPayment'), render: (r) => formatDate(r.last_payment_date) },
    { key: 'actions', header: '', render: (r) => recordButton(r.customer) },
  ];

  const deliveryColumns = [
    { key: 'date', header: t('duesView.columns.date'), render: (r) => formatDate(r.delivery_date) },
    { key: 'customer', header: t('duesView.columns.customer'), render: (r) => customerLink(r.customer) },
    vehicleOrg
      ? { key: 'vehicle', header: t('duesView.columns.vehicle'), render: (r) => (r.vehicle ? <Badge tone="neutral">{r.vehicle.vehicle_number}</Badge> : '—') }
      : { key: 'staff', header: t('duesView.columns.staff'), render: (r) => r.staff?.name || '—' },
    { key: 'product', header: t('duesView.columns.product'), render: (r) => r.product?.name || '—' },
    { key: 'quantity', header: t('duesView.columns.qty') },
    { key: 'total', header: t('duesView.columns.total'), render: (r) => formatCurrency(r.total_amount) },
    { key: 'paid', header: t('duesView.columns.paid'), render: (r) => formatCurrency(r.amount_paid) },
    { key: 'pending', header: t('duesView.columns.pending'), render: (r) => <strong style={owed}>{formatCurrency(r.pending_amount)}</strong> },
    { key: 'status', header: t('common.status'), render: (r) => <Badge tone={PAYMENT_STATUS_TONE[r.payment_status]}>{t(`badges.${r.payment_status}`)}</Badge> },
    { key: 'days', header: t('duesView.columns.days'), render: (r) => r.days_pending },
    { key: 'actions', header: '', render: (r) => recordButton(r.customer) },
  ];

  const groupColumns = [
    vehicleOrg
      ? { key: 'name', header: t('duesView.columns.vehicle'), render: (r) => (r.vehicle_id ? <strong>{r.vehicle_number}</strong> : <em>{t('duesView.noVehicle')}</em>) }
      : { key: 'name', header: t('duesView.columns.staff'), render: (r) => (r.staff_id ? <strong>{r.staff_name}</strong> : <em>{t('duesView.noStaff')}</em>) },
    ...(vehicleOrg ? [{ key: 'driver', header: t('duesView.columns.driver'), render: (r) => r.driver_name || '—' }] : []),
    { key: 'open', header: t('duesView.columns.openDeliveries'), render: (r) => r.open_deliveries_count },
    { key: 'pending', header: t('duesView.columns.pendingOnDeliveries'), render: (r) => <strong>{formatCurrency(r.pending_from_deliveries)}</strong> },
    { key: 'oldest', header: t('duesView.columns.oldest'), render: (r) => formatDate(r.oldest_unpaid_date) },
    { key: 'customers', header: t('duesView.columns.assignedCustomers'), render: (r) => r.assigned_customer_count },
    { key: 'customerDue', header: t('duesView.columns.assignedCustomerDue'), render: (r) => formatCurrency(r.assigned_customer_due) },
    {
      key: 'actions',
      header: '',
      render: (r) => {
        const id = vehicleOrg ? r.vehicle_id : r.staff_id;
        if (!id) return null;
        return (
          <Button type="button" variant="ghost" onClick={() => viewCustomersOf(vehicleOrg ? 'vehicle_id' : 'staff_id', id)}>
            {t('duesView.viewCustomers')}
          </Button>
        );
      },
    },
  ];

  const tabs = useMemo(() => [
    { value: 'customers', label: t('duesView.tabs.customers') },
    { value: 'deliveries', label: t('duesView.tabs.deliveries') },
    { value: groupTab, label: t(`duesView.tabs.${groupTab}`) },
  ], [t, groupTab]);

  const isGroupTab = tab === groupTab;
  const headlineAmount = isGroupTab
    ? groupSummary?.totals.pending_from_deliveries
    : tab === 'customers' ? totals?.total_due : totals?.total_pending;
  const headlineCount = isGroupTab ? groupSummary?.rows.length : pagination?.total;

  const groupOptions = vehicleOrg
    ? vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)
    : staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>);
  const showGroupFilter = vehicleOrg || canExport;

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('duesView.title')}</h1>
        {canExport && (
          <Button variant="secondary" onClick={() => exportPendingDuesCsv({ ...filters, search })}>{t('duesView.exportCsv')}</Button>
        )}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(next) => switchTab(next)} label={t('duesView.title')} />

      <StatGrid>
        <StatCard label={isGroupTab ? t('duesView.stats.pendingOnDeliveries') : t('duesView.stats.totalPending')} value={headlineAmount === undefined ? '—' : formatCurrency(headlineAmount)} />
        <StatCard label={t(`duesView.stats.count.${tab}`)} value={headlineCount ?? '—'} />
        {isGroupTab && groupSummary && (
          <StatCard label={t('duesView.stats.assignedCustomerDue')} value={formatCurrency(groupSummary.totals.assigned_customer_due)} />
        )}
      </StatGrid>

      {!isGroupTab && (
        <div className={`card ${styles.filters}`}>
          <div className={styles.search}>
            <TextInput name="search" aria-label={t('duesView.searchPlaceholder')} placeholder={t('duesView.searchPlaceholder')} value={search} onChange={handleSearchChange} />
          </div>
          {showGroupFilter && (
            <Select
              label={vehicleOrg ? t('duesView.filters.vehicle') : t('duesView.filters.staff')}
              value={vehicleOrg ? filters.vehicle_id : filters.staff_id}
              onChange={(e) => handleFilterChange(vehicleOrg ? 'vehicle_id' : 'staff_id', e.target.value)}
            >
              <option value="">{vehicleOrg ? t('duesView.filters.allVehicles') : t('duesView.filters.allStaff')}</option>
              {groupOptions}
            </Select>
          )}
          <Select label={t('duesView.filters.minimumAge')} value={filters.min_age_days} onChange={(e) => handleFilterChange('min_age_days', e.target.value)}>
            <option value="">{t('duesView.filters.anyAge')}</option>
            {AGE_OPTIONS.map((days) => <option key={days} value={String(days)}>{t('duesView.filters.days', { count: days })}</option>)}
          </Select>
          {tab === 'customers' && (
            <Select label={t('duesView.filters.sortBy')} value={filters.sort} onChange={(e) => handleFilterChange('sort', e.target.value)}>
              <option value="amount">{t('duesView.filters.highestFirst')}</option>
              <option value="oldest">{t('duesView.filters.oldestFirst')}</option>
            </Select>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: isGroupTab ? 16 : 0 }}>
        {error && <p className="errorText">{error}</p>}
        {loading ? <Spinner /> : (
          <>
            {tab === 'customers' && <Table columns={customerColumns} rows={rows} rowKey={(r) => r.customer.id} emptyMessage={t('duesView.emptyCustomers')} />}
            {tab === 'deliveries' && <Table columns={deliveryColumns} rows={rows} rowKey={(r) => r.id} emptyMessage={t('duesView.emptyDeliveries')} />}
            {isGroupTab && groupSummary && (
              <>
                <p className="mutedText" style={{ marginTop: 0 }}>{vehicleOrg ? t('duesView.vehicleHint') : t('duesView.staffHint')}</p>
                <Table
                  columns={groupColumns}
                  rows={groupSummary.rows}
                  rowKey={(r) => (vehicleOrg ? r.vehicle_id : r.staff_id) || 'none'}
                  emptyMessage={vehicleOrg ? t('duesView.emptyVehicles') : t('duesView.emptyStaff')}
                />
              </>
            )}
            {!isGroupTab && (
              <Pagination
                pagination={pagination}
                pageSize={pageSize}
                onPageChange={(next) => load(tab, search, filters, next, pageSize)}
                onPageSizeChange={(size) => { setPageSize(size); load(tab, search, filters, 1, size); }}
              />
            )}
          </>
        )}
      </div>

      {paymentTarget && (
        <RecordPaymentModal
          customerId={paymentTarget.id}
          customerName={paymentTarget.name}
          onClose={() => setPaymentTarget(null)}
          onRecorded={reload}
        />
      )}
    </div>
  );
}
