import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listCustomers, createCustomer, bulkAssignCustomers, bulkAssignCustomersToVehicle, bulkSetCustomerStatus } from '../../api/customers.api';
import { listStaff } from '../../api/staff.api';
import { listVehicles } from '../../api/vehicles.api';
import { useAuth } from '../../context/AuthContext';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { getTranslatorFor, resolveCustomerLanguage } from '../../i18n/tForLanguage';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import { formatCurrency } from '../../utils/paymentStatus';

const emptyForm = {
  name: '', phone: '', address: '', default_quantity: 1, custom_price_per_unit: '', assigned_staff_id: '', assigned_vehicle_id: '', opening_balance: '', preferred_language: '',
};

export default function CustomersPage() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [staffOptions, setStaffOptions] = useState([]);
  const [vehicleOptions, setVehicleOptions] = useState([]);
  // Which model the org runs decides whether customers belong to a staff
  // member (route_staff) or to a vehicle (vehicle_eod).
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', due_status: '', assigned_vehicle_id: '' });
  const [pageSize, setPageSize] = useState(10);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const searchDebounceRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignTargetId, setBulkAssignTargetId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  async function load(searchTerm, pageNum, currentFilters = filters, size = pageSize) {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const result = await listCustomers({ search: searchTerm, page: pageNum, page_size: size, with_due: 1, ...currentFilters });
      setCustomers(result.data);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === customers.length ? new Set() : new Set(customers.map((c) => c.id))));
  }

  async function handleBulkAssign(e) {
    e.preventDefault();
    setBulkBusy(true);
    try {
      if (vehicleOrg) await bulkAssignCustomersToVehicle(Array.from(selectedIds), bulkAssignTargetId);
      else await bulkAssignCustomers(Array.from(selectedIds), bulkAssignTargetId);
      setShowBulkAssign(false);
      setBulkAssignTargetId('');
      await load(search, pagination?.page || 1);
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmBulkDeactivate() {
    setConfirmDeactivate(false);
    setBulkBusy(true);
    try {
      await bulkSetCustomerStatus(Array.from(selectedIds), 'inactive');
      await load(search, pagination?.page || 1);
    } finally {
      setBulkBusy(false);
    }
  }

  // No WhatsApp Business API is configured for this app — this opens one
  // wa.me chat per selected customer with a prefilled reminder message; each
  // still needs a manual tap to actually send. Opened with a short stagger
  // so the browser doesn't treat a burst of window.open calls as a popup
  // flood and block them. The message is built in the CUSTOMER's own
  // preferred language (falling back to the org default), not the admin's
  // active UI language — see i18n/tForLanguage.js.
  function handleBulkWhatsApp() {
    const targets = customers.filter((c) => selectedIds.has(c.id) && c.phone);
    targets.forEach((c, index) => {
      setTimeout(() => {
        const tFor = getTranslatorFor(resolveCustomerLanguage(c, organization));
        const text = c.total_due > 0
          ? tFor('customers.bulk.whatsappReminderTemplate', {
            name: c.name,
            business: organization?.name || '',
            amount: formatCurrency(c.total_due),
            phone: organization?.phone_numbers?.[0] || '',
          })
          : tFor('customers.bulk.whatsappMessage', { name: c.name });
        window.open(`https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }, index * 400);
    });
  }

  useEffect(() => {
    load('', 1);
    if (organization?.delivery_model === 'vehicle_eod') listVehicles({ page_size: 100 }).then((r) => setVehicleOptions(r.data));
    else listStaff({ page_size: 100 }).then((r) => setStaffOptions(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearch(value);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => load(value, 1), 300);
  }

  function handleFilterChange(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    load(search, 1, next);
  }

  function handlePageChange(nextPage) {
    load(search, nextPage);
  }

  function handlePageSizeChange(nextSize) {
    setPageSize(nextSize);
    load(search, 1, filters, nextSize);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await createCustomer({
        ...form,
        custom_price_per_unit: form.custom_price_per_unit === '' ? null : form.custom_price_per_unit,
        assigned_staff_id: form.assigned_staff_id || null,
        assigned_vehicle_id: form.assigned_vehicle_id || null,
        opening_balance: form.opening_balance || 0,
        preferred_language: form.preferred_language || null,
      });
      setShowCreate(false);
      setForm(emptyForm);
      await load(search, 1);
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = [
    {
      key: 'select',
      header: <input type="checkbox" checked={customers.length > 0 && selectedIds.size === customers.length} onChange={toggleSelectAll} aria-label={t('customers.bulk.selectAll')} />,
      render: (r) => <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} aria-label={r.name} />,
      hideInCard: true,
    },
    { key: 'name', header: t('customers.columns.name'), render: (r) => <Link to={`/admin/customers/${r.id}`}>{r.name}</Link> },
    { key: 'phone', header: t('customers.columns.phone'), render: (r) => r.phone || '—' },
    {
      key: 'total_due',
      header: t('customers.columns.pending'),
      render: (r) => (
        <span style={{ fontWeight: 600, color: r.total_due > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {formatCurrency(r.total_due)}
        </span>
      ),
    },
    vehicleOrg
      ? { key: 'assigned_vehicle', header: t('customers.columns.vehicle'), render: (r) => r.assigned_vehicle?.vehicle_number || '—' }
      : { key: 'assigned_staff', header: t('customers.columns.staff'), render: (r) => r.assigned_staff?.name || '—' },
    { key: 'status', header: t('customers.columns.status'), render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? t('common.active') : t('common.inactive')}</Badge> },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('customers.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('customers.addCustomer')}</Button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <TextInput placeholder={t('customers.searchPlaceholder')} value={search} onChange={handleSearchChange} style={{ width: '100%', marginBottom: 16 }} />
        <div className="formGrid">
          <Select label={t('customers.filters.duePayment')} value={filters.due_status} onChange={(e) => handleFilterChange('due_status', e.target.value)}>
            <option value="">{t('customers.filters.anyDue')}</option>
            <option value="pending">{t('customers.filters.duePending')}</option>
            <option value="clear">{t('customers.filters.dueClear')}</option>
          </Select>
          <Select label={t('common.status')} value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
            <option value="">{t('common.allStatuses')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </Select>
          {vehicleOrg && (
            <Select label={t('customers.filters.vehicle')} value={filters.assigned_vehicle_id} onChange={(e) => handleFilterChange('assigned_vehicle_id', e.target.value)}>
              <option value="">{t('customers.filters.allVehicles')}</option>
              {vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)}
            </Select>
          )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong>{t('customers.bulk.selectedCount', { count: selectedIds.size })}</strong>
          <Button variant="secondary" disabled={bulkBusy} onClick={() => setShowBulkAssign(true)}>{vehicleOrg ? t('customers.bulk.assignVehicle') : t('customers.bulk.assignStaff')}</Button>
          <Button variant="secondary" disabled={bulkBusy} onClick={handleBulkWhatsApp}>{t('customers.bulk.sendWhatsApp')}</Button>
          <Button variant="danger" disabled={bulkBusy} onClick={() => setConfirmDeactivate(true)}>{t('customers.bulk.deactivate')}</Button>
          <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>{t('common.cancel')}</Button>
        </div>
      )}

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={customers} rowKey={(r) => r.id} emptyMessage={t('customers.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {showCreate && (
        <Modal title={t('customers.modal.title')} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextInput label={t('common.phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <TextInput label={t('customers.modal.defaultQuantity')} type="number" inputMode="decimal" step="0.01" min="0.01" value={form.default_quantity} onChange={(e) => setForm({ ...form, default_quantity: e.target.value })} />
              <TextInput label={t('customers.modal.customPrice')} type="number" inputMode="decimal" step="0.01" min="0" value={form.custom_price_per_unit} onChange={(e) => setForm({ ...form, custom_price_per_unit: e.target.value })} />
              {vehicleOrg ? (
                <Select label={t('customers.modal.assignedVehicle')} value={form.assigned_vehicle_id} onChange={(e) => setForm({ ...form, assigned_vehicle_id: e.target.value })}>
                  <option value="">{t('common.unassigned')}</option>
                  {vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)}
                </Select>
              ) : (
                <Select label={t('customers.modal.assignedStaff')} value={form.assigned_staff_id} onChange={(e) => setForm({ ...form, assigned_staff_id: e.target.value })}>
                  <option value="">{t('common.unassigned')}</option>
                  {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              )}
              <TextInput
                label={t('customers.modal.openingBalance')}
                type="number" inputMode="decimal" step="0.01" min="0"
                value={form.opening_balance}
                onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
              />
              <Select label={t('customers.modal.preferredLanguage')} value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}>
                <option value="">{t('customers.modal.useOrgDefault')}</option>
                {SUPPORTED_LANGUAGES.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
              </Select>
            </div>
            <TextInput label={t('common.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ marginTop: 16 }} />
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit">{t('common.create')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showBulkAssign && (
        <Modal title={vehicleOrg ? t('customers.bulk.assignVehicle') : t('customers.bulk.assignStaff')} onClose={() => setShowBulkAssign(false)}>
          <form onSubmit={handleBulkAssign}>
            <Select label={vehicleOrg ? t('customers.modal.assignedVehicle') : t('customers.modal.assignedStaff')} value={bulkAssignTargetId} onChange={(e) => setBulkAssignTargetId(e.target.value)}>
              <option value="">{t('common.unassigned')}</option>
              {vehicleOrg
                ? vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}{v.driver_name ? ` — ${v.driver_name}` : ''}</option>)
                : staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <div className="formActions">
              <Button type="submit" disabled={bulkBusy}>{bulkBusy ? t('common.saving') : t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowBulkAssign(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDeactivate && (
        <ConfirmDialog
          message={t('customers.bulk.deactivateConfirm', { count: selectedIds.size })}
          confirmLabel={t('customers.bulk.deactivate')}
          danger
          busy={bulkBusy}
          onConfirm={confirmBulkDeactivate}
          onCancel={() => setConfirmDeactivate(false)}
        />
      )}
    </div>
  );
}
