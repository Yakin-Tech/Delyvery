import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPortalData } from '../../api/portal.api';
import { getTranslatorFor } from '../../i18n/tForLanguage';
import Spinner from '../../components/common/Spinner';
import Badge from '../../components/common/Badge';
import Table from '../../components/common/Table';
import { PAYMENT_STATUS_TONE, formatCurrency, formatDate } from '../../utils/paymentStatus';
import styles from './PortalPage.module.css';

// Public, unauthenticated page — no AppLayout, no sidebar, no login, and no
// logged-in user to read a UI language from. Rendered in the CUSTOMER's own
// preferred_language (or their org's default) instead of always English —
// see getPortalData's `language` field and backend/src/controllers/
// portal.controller.js for exactly what this is allowed to show (this one
// customer's own data only).
export default function PortalPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPortalData(token)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const t = getTranslatorFor(data?.language);

  const columns = [
    { key: 'delivery_date', header: t('portal.columns.date'), render: (r) => formatDate(r.delivery_date) },
    { key: 'product_name', header: t('portal.columns.product'), render: (r) => r.product_name || '—' },
    { key: 'quantity', header: t('portal.columns.qty') },
    { key: 'total_amount', header: t('portal.columns.amount'), render: (r) => formatCurrency(r.total_amount) },
    { key: 'payment_status', header: t('common.status'), render: (r) => <Badge tone={PAYMENT_STATUS_TONE[r.payment_status]}>{t(`badges.${r.payment_status}`)}</Badge> },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {loading && <Spinner />}
        {!loading && error && <p className="errorText">{t('portal.invalidLink')}</p>}
        {!loading && data && (
          <>
            <h1 className={styles.title}>{data.customer_name}</h1>
            <div className={styles.statsRow}>
              <div>
                <div className="mutedText">{t('customers.detail.totalDue')}</div>
                <div className={styles.statValue} style={{ color: data.total_due > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                  {formatCurrency(data.total_due)}
                </div>
              </div>
              <div>
                <div className="mutedText">{t('portal.lastPayment')}</div>
                <div className={styles.statValue}>{data.last_payment_date ? formatDate(data.last_payment_date) : '—'}</div>
              </div>
            </div>

            <h2 style={{ marginTop: 24 }}>{t('portal.last30Days')}</h2>
            <Table columns={columns} rows={data.deliveries} rowKey={(r) => `${r.delivery_date}-${r.product_name}-${r.total_amount}`} emptyMessage={t('portal.noDeliveries')} />
          </>
        )}
      </div>
    </div>
  );
}
