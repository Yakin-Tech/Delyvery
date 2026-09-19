import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { fetchMySummary } from '../../api/deliveries.api';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import Tabs from '../../components/common/Tabs';
import ChartCard from '../../components/charts/ChartCard';
import DonutChart from '../../components/charts/DonutChart';
import { AXIS_TICK, GRID_STROKE, PALETTE, STATUS_COLORS, TOOLTIP_STYLE } from '../../components/charts/chartTheme';
import { localISODate } from '../../utils/dates';
import formatRelativeTime from '../../utils/formatRelativeTime';
import { PAYMENT_STATUS_TONE, formatCurrency, formatDate, formatShortDate } from '../../utils/paymentStatus';
import styles from './MySummaryPage.module.css';

const PERIODS = ['today', 'this_week', 'this_month'];
const PERIOD_KEY = { today: 'today', this_week: 'thisWeek', this_month: 'thisMonth' };

// What the signed-in staff member has done: headline numbers for today / this
// week / this month, a 7-day trend, how this month's money and deliveries break
// down, and the last things they entered.
export default function MySummaryPage() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMySummary({ today: localISODate() })
      .then(setSummary)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const tabs = useMemo(() => PERIODS.map((value) => ({ value, label: t(`mySummary.${PERIOD_KEY[value]}`) })), [t]);

  if (loading) return <div className="page"><Spinner /></div>;
  if (error || !summary) return <div className="page"><p className="errorText">{error}</p></div>;

  const current = summary[period];
  const payments = summary.payments_recorded[period];

  const trend = summary.daily.map((d) => ({ ...d, label: formatShortDate(d.date) }));
  const statusSlices = ['paid', 'partial', 'pending'].map((status) => ({
    name: t(`badges.${status}`), value: summary.month_by_status[status], color: STATUS_COLORS[status],
  }));
  const modeSlices = summary.month_collected_by_mode.map((m, i) => ({
    name: t(`paymentModes.${m.mode}`), value: m.amount, color: PALETTE[i % PALETTE.length],
  }));

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('mySummary.title')}</h1>
          <p className="mutedText" style={{ margin: 0 }}>{t('mySummary.subtitle')}</p>
        </div>
      </div>

      <Tabs tabs={tabs} value={period} onChange={setPeriod} label={t('mySummary.title')} />

      <StatGrid>
        <StatCard label={t('mySummary.deliveriesLogged')} value={current.deliveries_count} />
        <StatCard label={t('mySummary.customersServed')} value={current.customers_count} />
        <StatCard label={t('mySummary.totalValue')} value={formatCurrency(current.value)} />
        <StatCard label={t('mySummary.amountCollected')} value={formatCurrency(current.collected)} />
        <StatCard label={t('mySummary.pendingAdded')} value={formatCurrency(current.pending_added)} />
        {vehicleOrg && (
          <StatCard
            label={t('mySummary.paymentsRecorded', { count: payments.count })}
            value={formatCurrency(payments.amount)}
          />
        )}
      </StatGrid>

      <div className={styles.charts}>
        <ChartCard title={t('mySummary.lastSevenDays')} subtitle={t('mySummary.lastSevenDaysHint')} className={styles.wide}>
          <ResponsiveContainer>
            <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} width={44} allowDecimals={false} />
              <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-neutral-bg)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="value" name={t('mySummary.totalValue')} fill={PALETTE[0]} radius={[6, 6, 0, 0]} maxBarSize={36} />
              <Bar dataKey="collected" name={t('mySummary.amountCollected')} fill={PALETTE[1]} radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('mySummary.statusThisMonth')} height={200}>
          <DonutChart data={statusSlices} emptyLabel={t('mySummary.noData')} />
        </ChartCard>

        <ChartCard title={t('mySummary.collectedByMode')} subtitle={t('mySummary.thisMonthShort')} height={200}>
          <DonutChart data={modeSlices} format={formatCurrency} emptyLabel={t('mySummary.noData')} />
        </ChartCard>
      </div>

      <section className={`card ${styles.activity}`}>
        <h2 className={styles.activityTitle}>{t('mySummary.recentActivity')}</h2>
        {summary.recent_activity.length === 0 ? (
          <p className="mutedText">{t('mySummary.noActivity')}</p>
        ) : (
          <ul className={styles.list}>
            {summary.recent_activity.map((item) => (
              <li key={`${item.type}-${item.id}`} className={styles.item}>
                <Badge tone={item.type === 'payment' ? 'success' : 'neutral'}>{t(`mySummary.activity.${item.type}`)}</Badge>
                <div className={styles.itemMain}>
                  <span className={styles.customer}>
                    {vehicleOrg && item.customer
                      ? <Link to={`/staff/customers/${item.customer.id}`}>{item.customer.name}</Link>
                      : (item.customer?.name || '—')}
                  </span>
                  <span className={styles.meta}>
                    {[
                      formatDate(item.date),
                      item.payment_mode && item.paid > 0 ? t(`paymentModes.${item.payment_mode}`) : null,
                      item.vehicle?.vehicle_number,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className={styles.itemSide}>
                  <strong>{formatCurrency(item.amount)}</strong>
                  {item.type === 'delivery'
                    ? <Badge tone={PAYMENT_STATUS_TONE[item.payment_status]}>{t(`badges.${item.payment_status}`)}</Badge>
                    : null}
                  <span className={styles.meta}>{formatRelativeTime(item.at, t)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
