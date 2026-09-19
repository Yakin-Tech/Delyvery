import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listMyPendingDues } from '../../api/pendingDues.api';
import Table from '../../components/common/Table';
import Spinner from '../../components/common/Spinner';
import { formatCurrency, formatDate } from '../../utils/paymentStatus';

export default function MyPendingPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMyPendingDues().then(setRows).finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'customer', header: t('myPending.columns.customer'), render: (r) => r.customer.name },
    {
      key: 'phone',
      header: t('myPending.columns.phone'),
      render: (r) => (r.customer.phone ? <a href={`tel:${r.customer.phone}`}>{r.customer.phone}</a> : '—'),
    },
    { key: 'total_due', header: t('myPending.columns.totalDue'), render: (r) => <strong>{formatCurrency(r.total_due)}</strong> },
    { key: 'oldest_unpaid_date', header: t('myPending.columns.since'), render: (r) => formatDate(r.oldest_unpaid_date) },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('myPending.title')}</h1>
      </div>
      <div className="card">
        {loading ? <Spinner /> : (
          <Table columns={columns} rows={rows} rowKey={(r) => r.customer.id} emptyMessage={t('myPending.empty')} />
        )}
      </div>
    </div>
  );
}
