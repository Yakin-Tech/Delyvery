import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listOrganizations, createOrganization } from '../../api/superAdmin.api';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import { BUSINESS_TYPE_VALUES, ORG_STATUS_OPTIONS, ORG_STATUS_TONE, DELIVERY_MODEL_VALUES, businessTypeLabel, orgStatusLabel, deliveryModelLabel } from '../../utils/businessTypes';
import { formatDate } from '../../utils/paymentStatus';

const emptyForm = {
  name: '', business_type: 'water', business_type_other: '', delivery_model: 'route_staff', address: '', phone: '',
  admin_name: '', admin_phone: '', admin_password: '',
};

export default function OrganizationsPage() {
  const { t } = useTranslation();
  const [organizations, setOrganizations] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load(currentFilters, pageNum, size = pageSize) {
    setLoading(true);
    try {
      const result = await listOrganizations({ ...currentFilters, page: pageNum, page_size: size });
      setOrganizations(result.data);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(filters, 1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilterChange(field, value) {
    const next = { ...filters, [field]: value };
    setFilters(next);
    load(next, 1);
  }

  function handlePageChange(nextPage) {
    load(filters, nextPage);
  }

  function handlePageSizeChange(nextSize) {
    setPageSize(nextSize);
    load(filters, 1, nextSize);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const business_type = form.business_type === 'other' ? (form.business_type_other || 'other') : form.business_type;
      await createOrganization({
        name: form.name,
        business_type,
        delivery_model: form.delivery_model,
        address: form.address || undefined,
        phone_numbers: form.phone ? [form.phone] : [],
        admin_name: form.admin_name,
        admin_phone: form.admin_phone,
        admin_password: form.admin_password,
      });
      setShowCreate(false);
      setForm(emptyForm);
      await load(filters, 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: t('superAdmin.organizations.columns.org'), render: (r) => <Link to={`/super-admin/organizations/${r.id}`}>{r.name}</Link> },
    { key: 'business_type', header: t('superAdmin.organizations.columns.type'), render: (r) => businessTypeLabel(r.business_type, t) },
    { key: 'customer_count', header: t('superAdmin.organizations.columns.customers') },
    { key: 'status', header: t('superAdmin.organizations.columns.status'), render: (r) => <Badge tone={ORG_STATUS_TONE[r.status]}>{orgStatusLabel(r.status, t)}</Badge> },
    { key: 'last_active_at', header: t('superAdmin.organizations.columns.lastActive'), render: (r) => formatDate(r.last_active_at) },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('superAdmin.organizations.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('superAdmin.organizations.createOrg')}</Button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="formGrid">
          <TextInput
            label={t('superAdmin.organizations.search')}
            placeholder={t('superAdmin.organizations.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
          />
          <Select label={t('common.status')} value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
            <option value="">{t('common.allStatuses')}</option>
            {ORG_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{orgStatusLabel(s, t)}</option>)}
          </Select>
        </div>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={organizations} rowKey={(r) => r.id} emptyMessage={t('superAdmin.organizations.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {showCreate && (
        <Modal title={t('superAdmin.organizations.modal.title')} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <div className="formGrid">
              <TextInput label={t('superAdmin.organizations.modal.orgName')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select label={t('superAdmin.organizations.modal.businessType')} value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })}>
                {BUSINESS_TYPE_VALUES.map((v) => <option key={v} value={v}>{t(`businessTypes.${v}`)}</option>)}
              </Select>
              {form.business_type === 'other' && (
                <TextInput label={t('superAdmin.organizations.modal.describeType')} required value={form.business_type_other} onChange={(e) => setForm({ ...form, business_type_other: e.target.value })} />
              )}
              <Select label={t('superAdmin.organizations.modal.deliveryModel')} value={form.delivery_model} onChange={(e) => setForm({ ...form, delivery_model: e.target.value })}>
                {DELIVERY_MODEL_VALUES.map((v) => <option key={v} value={v}>{deliveryModelLabel(v, t)}</option>)}
              </Select>
              <TextInput label={t('superAdmin.organizations.modal.phoneNumber')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <TextInput label={t('common.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ marginTop: 16 }} />

            <h3 style={{ marginTop: 20 }}>{t('superAdmin.organizations.modal.firstOrgAdmin')}</h3>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
              <TextInput label={t('common.phone')} required value={form.admin_phone} onChange={(e) => setForm({ ...form, admin_phone: e.target.value })} />
              <TextInput label={t('auth.password')} type="password" required value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
            </div>

            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit" disabled={saving}>{saving ? t('superAdmin.organizations.modal.creating') : t('superAdmin.organizations.modal.create')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
