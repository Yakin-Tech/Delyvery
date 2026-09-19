import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listStaff, createStaff, updateStaff, resetStaffPassword } from '../../api/staff.api';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Modal from '../../components/common/Modal';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';

const emptyForm = { name: '', phone: '', password: '', assigned_zone: '' };

export default function StaffPage() {
  const { t } = useTranslation();
  const [staff, setStaff] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPasswordValue] = useState('');

  async function load(pageNum, size = pageSize) {
    setLoading(true);
    try {
      const result = await listStaff({ page: pageNum, page_size: size });
      setStaff(result.data);
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

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await createStaff(form);
      setShowCreate(false);
      setForm(emptyForm);
      setPage(1);
      await load(1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleStatus(member) {
    await updateStaff(member.id, { status: member.status === 'active' ? 'inactive' : 'active' });
    await load(page);
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    await resetStaffPassword(resetTarget.id, resetPassword);
    setResetTarget(null);
    setResetPasswordValue('');
  }

  const columns = [
    { key: 'name', header: t('staff.columns.name') },
    { key: 'phone', header: t('staff.columns.phone') },
    { key: 'assigned_zone', header: t('staff.columns.zone'), render: (r) => r.assigned_zone || '—' },
    { key: 'status', header: t('staff.columns.status'), render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? t('common.active') : t('common.inactive')}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => setResetTarget(r)}>{t('staff.resetPassword')}</Button>
          <Button variant="ghost" onClick={() => toggleStatus(r)}>
            {r.status === 'active' ? t('staff.deactivate') : t('staff.activate')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('staff.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('staff.addStaff')}</Button>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={staff} rowKey={(r) => r.id} emptyMessage={t('staff.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {showCreate && (
        <Modal title={t('staff.modal.title')} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextInput label={t('common.phone')} required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <TextInput label={t('staff.modal.password')} type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <TextInput label={t('staff.modal.zoneOptional')} value={form.assigned_zone} onChange={(e) => setForm({ ...form, assigned_zone: e.target.value })} />
            </div>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit">{t('common.create')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {resetTarget && (
        <Modal title={t('staff.resetModal.title', { name: resetTarget.name })} onClose={() => setResetTarget(null)}>
          <form onSubmit={handleResetPassword}>
            <TextInput label={t('staff.resetModal.newPassword')} type="password" required value={resetPassword} onChange={(e) => setResetPasswordValue(e.target.value)} />
            <div className="formActions">
              <Button type="submit">{t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
