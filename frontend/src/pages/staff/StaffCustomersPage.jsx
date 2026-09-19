import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listCustomers } from '../../api/customers.api';
import { listVehicles } from '../../api/vehicles.api';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import RecordPaymentModal from '../../components/payments/RecordPaymentModal';
import { formatCurrency } from '../../utils/paymentStatus';

// Every customer with what they currently owe. For office staff in a
// vehicle_eod org: look someone up, see their balance, open their page, or
// record a payment straight from the row.
export default function StaffCustomersPage() {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageSize, setPageSize] = useState(20);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ due_status: '', assigned_vehicle_id: '', status: 'active' });
  const [paymentTarget, setPaymentTarget] = useState(null);
  const debounceRef = useRef(null);
  const requestRef = useRef(0);

  async function load(searchTerm, currentFilters, pageNum, size) {
    const requestId = (requestRef.current += 1);
    setLoading(true);
    try {
      const result = await listCustomers({ search: searchTerm, page: pageNum, page_size: size, with_due: 1, ...currentFilters });
      // A slower, older request must never overwrite the newer one's rows.
      if (requestId !== requestRef.current) return;
      setCustomers(result.data);
      setPagination(result.pagination);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load('', filters, 1, pageSize);
    listVehicles({ page_size: 100 }).then((r) => setVehicles(r.data)).catch(() => setVehicles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(value, filters, 1, pageSize), 300);
  }

  function handleFilterChange(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    load(search, next, 1, pageSize);
  }

  const columns = [
    { key: 'name', header: t('staffCustomers.columns.name'), render: (r) => <Link to={`/staff/customers/${r.id}`}><strong>{r.name}</strong></Link> },
    { key: 'phone', header: t('staffCustomers.columns.phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—') },
    { key: 'vehicle', header: t('staffCustomers.columns.vehicle'), render: (r) => (r.assigned_vehicle ? <Badge tone="neutral">{r.assigned_vehicle.vehicle_number}</Badge> : '—') },
    {
      key: 'total_due',
      header: t('staffCustomers.columns.pending'),
      render: (r) => (
        <strong style={{ color: r.total_due > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>{formatCurrency(r.total_due)}</strong>
      ),
    },
    {
      key: 'actions',
      header: '',
      hideInCard: false,
      render: (r) => (
        <Button type="button" variant={r.total_due > 0 ? 'secondary' : 'ghost'} onClick={() => setPaymentTarget(r)}>
          {t('staffCustomers.recordPayment')}
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('staffCustomers.title')}</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <TextInput
          name="search"
          placeholder={t('staffCustomers.searchPlaceholder')}
          value={search}
          onChange={handleSearchChange}
          style={{ width: '100%', marginBottom: 16 }}
        />
        <div className="formGrid">
          <Select label={t('staffCustomers.filters.pending')} value={filters.due_status} onChange={(e) => handleFilterChange('due_status', e.target.value)}>
            <option value="">{t('staffCustomers.filters.anyPending')}</option>
            <option value="pending">{t('staffCustomers.filters.withPending')}</option>
            <option value="clear">{t('staffCustomers.filters.noPending')}</option>
          </Select>
          <Select label={t('staffCustomers.filters.vehicle')} value={filters.assigned_vehicle_id} onChange={(e) => handleFilterChange('assigned_vehicle_id', e.target.value)}>
            <option value="">{t('staffCustomers.filters.allVehicles')}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)}
          </Select>
          <Select label={t('common.status')} value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
            <option value="">{t('common.allStatuses')}</option>
          </Select>
        </div>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={customers} rowKey={(r) => r.id} emptyMessage={t('staffCustomers.empty')} />
            <Pagination
              pagination={pagination}
              pageSize={pageSize}
              onPageChange={(next) => load(search, filters, next, pageSize)}
              onPageSizeChange={(size) => { setPageSize(size); load(search, filters, 1, size); }}
            />
          </>
        )}
      </div>

      {paymentTarget && (
        <RecordPaymentModal
          customerId={paymentTarget.id}
          customerName={paymentTarget.name}
          onClose={() => setPaymentTarget(null)}
          onRecorded={() => load(search, filters, pagination?.page || 1, pageSize)}
        />
      )}
    </div>
  );
}
