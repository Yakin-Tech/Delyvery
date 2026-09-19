import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  getOrganization, updateOrganization, createOrgAdmin, updateOrgAdminStatus, resetOrgAdminPassword, impersonateOrganization,
} from '../../api/superAdmin.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import { BUSINESS_TYPE_VALUES, ORG_STATUS_OPTIONS, DELIVERY_MODEL_VALUES, businessTypeLabel, orgStatusLabel, deliveryModeLabel, deliveryModelLabel } from '../../utils/businessTypes';
import { formatDate } from '../../utils/paymentStatus';
import { describeAuditAction } from '../../utils/auditLog';

const emptyAdminForm = { name: '', phone: '', password: '' };

export default function OrganizationDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { startImpersonation } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [adminForm, setAdminForm] = useState(emptyAdminForm);
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPasswordValue] = useState('');
  const [pendingDeliveryModel, setPendingDeliveryModel] = useState(null);
  const [modelBusy, setModelBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await getOrganization(id));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    const org = data.organization;
    const isKnownType = BUSINESS_TYPE_VALUES.includes(org.business_type);
    setEditForm({
      name: org.name,
      business_type: isKnownType ? org.business_type : 'other',
      business_type_other: isKnownType ? '' : org.business_type,
      address: org.address || '',
      phone: (org.phone_numbers && org.phone_numbers[0]) || '',
    });
    setEditing(true);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    const business_type = editForm.business_type === 'other' ? (editForm.business_type_other || 'other') : editForm.business_type;
    await updateOrganization(id, {
      name: editForm.name,
      business_type,
      address: editForm.address,
      phone_numbers: editForm.phone ? [editForm.phone] : [],
    });
    setEditing(false);
    await load();
  }

  async function handleStatusChange(status) {
    await updateOrganization(id, { status });
    await load();
  }

  // Switching model changes what the org's staff and admin see across the
  // whole app, so it goes through a confirmation instead of applying on change.
  async function confirmDeliveryModelChange() {
    setModelBusy(true);
    try {
      await updateOrganization(id, { delivery_model: pendingDeliveryModel });
      setPendingDeliveryModel(null);
      await load();
    } finally {
      setModelBusy(false);
    }
  }

  async function handleAddAdmin(e) {
    e.preventDefault();
    setError('');
    try {
      await createOrgAdmin(id, adminForm);
      setShowAddAdmin(false);
      setAdminForm(emptyAdminForm);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAdminStatus(admin) {
    await updateOrgAdminStatus(id, admin.id, admin.status === 'active' ? 'inactive' : 'active');
    await load();
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    await resetOrgAdminPassword(id, resetTarget.id, resetPassword);
    setResetTarget(null);
    setResetPasswordValue('');
  }

  async function handleImpersonate() {
    const result = await impersonateOrganization(id);
    startImpersonation(result);
    navigate('/admin/customers');
  }

  if (loading || !data) return <Spinner />;

  const { organization, admins, stats, recent_audit_log } = data;
  const hasActiveAdmin = admins.some((a) => a.status === 'active');

  const adminColumns = [
    { key: 'name', header: t('superAdmin.orgDetail.columns.name') },
    { key: 'phone', header: t('superAdmin.orgDetail.columns.phone') },
    { key: 'status', header: t('superAdmin.orgDetail.columns.status'), render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? t('common.active') : t('common.inactive')}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => setResetTarget(r)}>{t('superAdmin.orgDetail.resetPassword')}</Button>
          <Button variant="ghost" onClick={() => toggleAdminStatus(r)}>
            {r.status === 'active' ? t('superAdmin.orgDetail.deactivate') : t('superAdmin.orgDetail.activate')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <Link to="/super-admin/organizations" className="mutedText">{t('common.backTo', { page: t('superAdmin.organizations.title') })}</Link>
          <h1>{organization.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={startEdit}>{t('superAdmin.orgDetail.edit')}</Button>
          <Button onClick={handleImpersonate} disabled={!hasActiveAdmin}>
            {t('superAdmin.orgDetail.viewAsOrgAdmin')}
          </Button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.businessType')}</div>
          <div>{businessTypeLabel(organization.business_type, t)}</div>
        </div>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.address')}</div>
          <div>{organization.address || '—'}</div>
        </div>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.phone')}</div>
          <div>{(organization.phone_numbers || []).join(', ') || '—'}</div>
        </div>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.unitOfMeasure')}</div>
          <div>{organization.unit_of_measure} <span className="mutedText">{t('superAdmin.orgDetail.setByOrgAdmin')}</span></div>
        </div>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.deliveryModes')}</div>
          <div>
            {(organization.delivery_modes || []).length
              ? organization.delivery_modes.map((m) => deliveryModeLabel(m, t)).join(', ')
              : '—'}
          </div>
        </div>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.deliveryModel')}</div>
          <Select value={organization.delivery_model || 'route_staff'} onChange={(e) => setPendingDeliveryModel(e.target.value)} style={{ minWidth: 220 }}>
            {DELIVERY_MODEL_VALUES.map((v) => <option key={v} value={v}>{deliveryModelLabel(v, t)}</option>)}
          </Select>
        </div>
        <div>
          <div className="mutedText">{t('superAdmin.orgDetail.status')}</div>
          <Select value={organization.status} onChange={(e) => handleStatusChange(e.target.value)} style={{ minWidth: 140 }}>
            {ORG_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{orgStatusLabel(s, t)}</option>)}
          </Select>
        </div>
      </div>

      <StatGrid>
        <StatCard label={t('superAdmin.orgDetail.customers')} value={stats.customer_count} />
        <StatCard label={t('superAdmin.orgDetail.staff')} value={stats.staff_count} />
        <StatCard label={t('superAdmin.orgDetail.deliveries')} value={stats.delivery_count} />
      </StatGrid>

      <div className="pageHeader" style={{ marginTop: 32 }}>
        <h2>{t('superAdmin.orgDetail.orgAdmins')}</h2>
        <Button variant="secondary" onClick={() => setShowAddAdmin(true)}>{t('superAdmin.orgDetail.addOrgAdmin')}</Button>
      </div>
      <div className="card" style={{ marginBottom: 24 }}>
        <Table columns={adminColumns} rows={admins} rowKey={(r) => r.id} emptyMessage={t('superAdmin.orgDetail.empty')} />
      </div>

      <h2>{t('superAdmin.orgDetail.recentActivity')}</h2>
      <div className="card">
        {recent_audit_log.length === 0 && <p className="mutedText">{t('superAdmin.orgDetail.noActivity')}</p>}
        {recent_audit_log.map((entry) => (
          <div key={entry.id} style={{ padding: '8px 0' }}>
            <div>{describeAuditAction({ ...entry, organization }, t)}</div>
            <div className="mutedText">{formatDate(entry.created_at)}</div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title={t('superAdmin.orgDetail.editTitle')} onClose={() => setEditing(false)}>
          <form onSubmit={handleSaveEdit}>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <Select label={t('superAdmin.organizations.modal.businessType')} value={editForm.business_type} onChange={(e) => setEditForm({ ...editForm, business_type: e.target.value })}>
                {BUSINESS_TYPE_VALUES.map((v) => <option key={v} value={v}>{t(`businessTypes.${v}`)}</option>)}
              </Select>
              {editForm.business_type === 'other' && (
                <TextInput label={t('superAdmin.organizations.modal.describeType')} required value={editForm.business_type_other} onChange={(e) => setEditForm({ ...editForm, business_type_other: e.target.value })} />
              )}
              <TextInput label={t('superAdmin.organizations.modal.phoneNumber')} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <TextInput label={t('common.address')} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} style={{ marginTop: 16 }} />
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showAddAdmin && (
        <Modal title={t('superAdmin.orgDetail.addOrgAdmin')} onClose={() => setShowAddAdmin(false)}>
          <form onSubmit={handleAddAdmin}>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} />
              <TextInput label={t('common.phone')} required value={adminForm.phone} onChange={(e) => setAdminForm({ ...adminForm, phone: e.target.value })} />
              <TextInput label={t('auth.password')} type="password" required value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} />
            </div>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit">{t('common.create')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowAddAdmin(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {resetTarget && (
        <Modal title={t('superAdmin.orgDetail.resetModal.title', { name: resetTarget.name })} onClose={() => setResetTarget(null)}>
          <form onSubmit={handleResetPassword}>
            <TextInput label={t('superAdmin.orgDetail.resetModal.newPassword')} type="password" required value={resetPassword} onChange={(e) => setResetPasswordValue(e.target.value)} />
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeliveryModel && (
        <ConfirmDialog
          message={t(pendingDeliveryModel === 'vehicle_eod' ? 'superAdmin.orgDetail.deliveryModelConfirmToVehicle' : 'superAdmin.orgDetail.deliveryModelConfirmToRoute', {
            // The short names from Settings, not the long dropdown labels, so the sentence stays readable.
            model: t(pendingDeliveryModel === 'vehicle_eod' ? 'settings.deliveryModelVehicleEod' : 'settings.deliveryModelRouteStaff'),
          })}
          confirmLabel={t('common.confirm')}
          busy={modelBusy}
          onConfirm={confirmDeliveryModelChange}
          onCancel={() => setPendingDeliveryModel(null)}
        />
      )}
    </div>
  );
}
