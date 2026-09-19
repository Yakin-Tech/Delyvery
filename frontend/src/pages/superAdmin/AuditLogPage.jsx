import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listAuditLog, listOrganizations } from '../../api/superAdmin.api';
import Select from '../../components/common/Select';
import Table from '../../components/common/Table';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import { formatDate } from '../../utils/paymentStatus';
import { describeAuditAction } from '../../utils/auditLog';

const ACTIONS = [
  'organization_created',
  'organization_status_changed',
  'org_admin_created',
  'org_admin_activated',
  'org_admin_deactivated',
  'impersonation_started',
];

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ organization_id: '', action: '' });

  async function load(currentFilters, pageNum, size = pageSize) {
    setLoading(true);
    try {
      const result = await listAuditLog({ ...currentFilters, page: pageNum, page_size: size });
      setEntries(result.data);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(filters, 1);
    listOrganizations({ page_size: 200 }).then((r) => setOrganizations(r.data));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const columns = [
    { key: 'created_at', header: t('superAdmin.auditLog.columns.when'), render: (r) => formatDate(r.created_at) },
    { key: 'description', header: t('superAdmin.auditLog.columns.activity'), render: (r) => describeAuditAction(r, t) },
    { key: 'action', header: t('superAdmin.auditLog.columns.action'), render: (r) => <code>{r.action}</code> },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('superAdmin.auditLog.title')}</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="formGrid">
          <Select label={t('superAdmin.auditLog.organization')} value={filters.organization_id} onChange={(e) => handleFilterChange('organization_id', e.target.value)}>
            <option value="">{t('superAdmin.auditLog.allOrgs')}</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <Select label={t('superAdmin.auditLog.action')} value={filters.action} onChange={(e) => handleFilterChange('action', e.target.value)}>
            <option value="">{t('superAdmin.auditLog.allActions')}</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </div>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={entries} rowKey={(r) => r.id} emptyMessage={t('superAdmin.auditLog.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>
    </div>
  );
}
