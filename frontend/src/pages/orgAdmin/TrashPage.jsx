import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listTrash, restoreFromTrash, permanentlyDelete, anonymizeInTrash, forceDeleteFromTrash } from '../../api/trash.api';
import Button from '../../components/common/Button';
import IconButton from '../../components/common/IconButton';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import { formatDate } from '../../utils/paymentStatus';

const TYPES = ['vehicle', 'staff', 'customer', 'product'];

export default function TrashPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resolveMode, setResolveMode] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load(pageNum = page, currentType = type, size = pageSize) {
    setLoading(true);
    try {
      const result = await listTrash({ page: pageNum, page_size: size, type: currentType || undefined });
      setItems(result.data);
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
    load(1, type, nextSize);
  }

  function handleTypeChange(e) {
    const nextType = e.target.value;
    setType(nextType);
    setPage(1);
    load(1, nextType);
  }

  async function handleRestore(item) {
    setRestoringId(item.id);
    try {
      await restoreFromTrash(item.type, item.id);
      await load(page);
    } finally {
      setRestoringId(null);
    }
  }

  function openDelete(item) {
    setDeleteTarget(item);
    setResolveMode(false);
    setDeleteError('');
  }

  function closeDeleteFlow() {
    setDeleteTarget(null);
    setResolveMode(false);
    setDeleteError('');
  }

  // The plain permanent-delete only succeeds when nothing still references
  // this record. A 409 means it's blocked — rather than a dead-end error,
  // that switches the same dialog into the two-choice "how do you want to
  // resolve this" view (resolveMode) instead of leaving the item stuck.
  async function confirmPermanentDelete() {
    setDeleteError('');
    setDeleteBusy(true);
    try {
      await permanentlyDelete(deleteTarget.type, deleteTarget.id);
      closeDeleteFlow();
      await load(page);
    } catch (err) {
      if (err.status === 409) setResolveMode(true);
      else setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleAnonymize() {
    setDeleteError('');
    setDeleteBusy(true);
    try {
      await anonymizeInTrash(deleteTarget.type, deleteTarget.id);
      closeDeleteFlow();
      await load(page);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleForceDelete() {
    setDeleteError('');
    setDeleteBusy(true);
    try {
      await forceDeleteFromTrash(deleteTarget.type, deleteTarget.id);
      closeDeleteFlow();
      await load(page);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns = [
    { key: 'type', header: t('trash.columns.type'), render: (r) => <Badge>{t(`trash.types.${r.type}`)}</Badge> },
    { key: 'name', header: t('trash.columns.name'), render: (r) => <>{r.name}{r.subtitle && <span className="mutedText"> · {r.subtitle}</span>}</> },
    { key: 'deleted_at', header: t('trash.columns.deletedAt'), render: (r) => formatDate(r.deleted_at) },
    { key: 'deleted_by', header: t('trash.columns.deletedBy'), render: (r) => r.deleted_by?.name || '—' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconButton icon="restore" label={t('trash.restore')} disabled={restoringId === r.id} onClick={() => handleRestore(r)} />
          <IconButton icon="delete" label={t('trash.deletePermanently')} onClick={() => openDelete(r)} />
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('trash.title')}</h1>
      </div>
      <p className="mutedText" style={{ marginTop: -8, marginBottom: 16 }}>{t('trash.hint')}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <Select label={t('trash.columns.type')} value={type} onChange={handleTypeChange} style={{ maxWidth: 240 }}>
          <option value="">{t('trash.filterAll')}</option>
          {TYPES.map((v) => <option key={v} value={v}>{t(`trash.types.${v}`)}</option>)}
        </Select>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={items} rowKey={(r) => `${r.type}-${r.id}`} emptyMessage={t('trash.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {deleteTarget && !resolveMode && (
        <ConfirmDialog
          message={t('trash.deletePermanentlyConfirm', { name: deleteTarget.name })}
          confirmLabel={t('trash.deletePermanently')}
          danger
          busy={deleteBusy}
          hint={t('trash.deletePermanentlyHint')}
          error={deleteError}
          onConfirm={confirmPermanentDelete}
          onCancel={closeDeleteFlow}
        />
      )}

      {deleteTarget && resolveMode && (
        <Modal title={t('trash.resolveTitle', { name: deleteTarget.name })} onClose={closeDeleteFlow}>
          <p>{t('trash.resolveMessage', { name: deleteTarget.name })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
            <div>
              <Button type="button" disabled={deleteBusy} onClick={handleAnonymize} style={{ width: '100%' }}>
                {deleteBusy ? t('common.saving') : t('trash.resolveAnonymize')}
              </Button>
              <p className="mutedText" style={{ marginTop: 6, marginBottom: 0 }}>
                {t('trash.resolveAnonymizeHint', { name: deleteTarget.name, type: t(`trash.types.${deleteTarget.type}`) })}
              </p>
            </div>
            <div>
              <Button type="button" variant="danger" disabled={deleteBusy} onClick={handleForceDelete} style={{ width: '100%' }}>
                {deleteBusy ? t('common.saving') : t('trash.resolveForceDelete')}
              </Button>
              <p className="mutedText" style={{ marginTop: 6, marginBottom: 0 }}>
                {t('trash.resolveForceDeleteHint', { name: deleteTarget.name })}
              </p>
            </div>
          </div>
          {deleteError && <p className="errorText" style={{ marginTop: 16 }}>{deleteError}</p>}
          <div className="formActions">
            <Button type="button" variant="secondary" onClick={closeDeleteFlow}>{t('common.cancel')}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
