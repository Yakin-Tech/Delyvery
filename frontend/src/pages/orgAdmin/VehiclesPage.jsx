import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listVehicles, createVehicle, updateVehicle } from '../../api/vehicles.api';
import Button from '../../components/common/Button';
import IconButton from '../../components/common/IconButton';
import TextInput from '../../components/common/TextInput';
import Modal from '../../components/common/Modal';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';

const emptyForm = { vehicle_number: '', label: '', driver_name: '', driver_phone: '', notes: '' };

export default function VehiclesPage() {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = closed, 'new' = create, or a vehicle row = edit
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load(pageNum, size = pageSize) {
    setLoading(true);
    try {
      const result = await listVehicles({ page: pageNum, page_size: size });
      setVehicles(result.data);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(nextPage) {
    setPage(nextPage);
    load(nextPage);
  }

  function handlePageSizeChange(nextSize) {
    setPageSize(nextSize);
    setPage(1);
    load(1, nextSize);
  }

  function openCreate() {
    setForm(emptyForm);
    setError('');
    setEditing('new');
  }

  function openEdit(vehicle) {
    setForm({
      vehicle_number: vehicle.vehicle_number,
      label: vehicle.label || '',
      driver_name: vehicle.driver_name || '',
      driver_phone: vehicle.driver_phone || '',
      notes: vehicle.notes || '',
    });
    setError('');
    setEditing(vehicle);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing === 'new') {
        await createVehicle(form);
        setPage(1);
        await load(1);
      } else {
        await updateVehicle(editing.id, form);
        await load(page);
      }
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(vehicle) {
    await updateVehicle(vehicle.id, { status: vehicle.status === 'active' ? 'inactive' : 'active' });
    await load(page);
  }

  const columns = [
    { key: 'vehicle_number', header: t('vehicles.columns.number'), render: (r) => <strong>{r.vehicle_number}</strong> },
    { key: 'label', header: t('vehicles.columns.label'), render: (r) => r.label || '—' },
    { key: 'driver_name', header: t('vehicles.columns.driver'), render: (r) => r.driver_name || '—' },
    { key: 'driver_phone', header: t('vehicles.columns.driverPhone'), render: (r) => r.driver_phone || '—' },
    { key: 'status', header: t('vehicles.columns.status'), render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? t('common.active') : t('common.inactive')}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <IconButton icon="edit" label={t('common.edit')} onClick={() => openEdit(r)} />
          <Button variant="ghost" onClick={() => toggleStatus(r)}>
            {r.status === 'active' ? t('vehicles.deactivate') : t('vehicles.activate')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('vehicles.title')}</h1>
        <Button onClick={openCreate}>{t('vehicles.addVehicle')}</Button>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={vehicles} rowKey={(r) => r.id} emptyMessage={t('vehicles.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {editing && (
        <Modal title={editing === 'new' ? t('vehicles.modal.addTitle') : t('vehicles.modal.editTitle', { number: editing.vehicle_number })} onClose={() => setEditing(null)}>
          <form onSubmit={handleSave}>
            <div className="formGrid">
              <TextInput label={t('vehicles.modal.number')} required value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="KA 01 AB 1234" />
              <TextInput label={t('vehicles.modal.label')} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              <TextInput label={t('vehicles.modal.driverName')} value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
              <TextInput label={t('vehicles.modal.driverPhone')} value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} />
              <TextInput label={t('vehicles.modal.notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="mutedText">{t('vehicles.modal.numberHint')}</p>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
