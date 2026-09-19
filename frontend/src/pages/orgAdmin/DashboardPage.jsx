import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { STATUS_COLORS } from '../../components/charts/chartTheme';
import { getDashboard } from '../../api/dashboard.api';
import { getStockSummary } from '../../api/stock.api';
import { useAuth } from '../../context/AuthContext';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Spinner from '../../components/common/Spinner';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import ProgressBar from '../../components/common/ProgressBar';
import { formatCurrency, formatDate, formatShortDate as shortDate } from '../../utils/paymentStatus';
import { unitLabel } from '../../utils/businessTypes';
import { DATE_RANGE_PRESETS, computeDateRange } from '../../utils/dateRanges';
import styles from './DashboardPage.module.css';

const UNLOGGED_ALERT_HOUR = 12; // spec: flag unlogged deliveries "past noon"

function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ marginBottom: 16 }}>{title}</h2>
      <div style={{ width: '100%', height: 260 }}>{children}</div>
    </div>
  );
}

function RouteStatusWidget({ status, t }) {
  const pct = status.total > 0 ? Math.round(((status.delivered + status.skipped) / status.total) * 100) : 0;
  return (
    <div className={`card ${styles.widget}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.routeStatus')}</h3>
      <ProgressBar percent={pct} />
      <div className={styles.routeStatusRow}>
        <span><strong>{status.delivered}</strong> {t('runSheet.status.delivered').toLowerCase()}</span>
        <span><strong>{status.skipped}</strong> {t('runSheet.status.skipped').toLowerCase()}</span>
        <span><strong>{status.pending}</strong> {t('runSheet.status.pending').toLowerCase()}</span>
        <span className="mutedText">/ {status.total}</span>
      </div>
    </div>
  );
}

function UnloggedAlertWidget({ unlogged, t }) {
  const isPastCutoff = new Date().getHours() >= UNLOGGED_ALERT_HOUR;
  if (unlogged.length === 0) return null;
  return (
    <div className={`card ${styles.widget} ${isPastCutoff ? styles.alertCard : ''}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.unlogged')}</h3>
      <p className={styles.bigNumber}>{unlogged.length}</p>
      <p className="mutedText">{t('dashboard.widgets.unloggedHint')}</p>
      <ul className={styles.unloggedList}>
        {unlogged.slice(0, 5).map((c) => (
          <li key={c.id}>{c.name}{c.assigned_staff_name ? ` — ${c.assigned_staff_name}` : ''}</li>
        ))}
      </ul>
      {unlogged.length > 5 && <p className="mutedText">{t('dashboard.widgets.andMore', { count: unlogged.length - 5 })}</p>}
    </div>
  );
}

function PaymentModeWidget({ breakdown, t }) {
  const total = breakdown.reduce((sum, b) => sum + b.amount, 0);
  return (
    <div className={`card ${styles.widget}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.cashVsUpi')}</h3>
      {breakdown.length === 0 ? <p className="mutedText">{t('dashboard.widgets.noCollectionsToday')}</p> : (
        <div className={styles.modeList}>
          {breakdown.map((b) => (
            <div key={b.mode} className={styles.modeRow}>
              <span>{t(`paymentModes.${b.mode}`, { defaultValue: b.mode })}</span>
              <span>
                <strong>{formatCurrency(b.amount)}</strong>
                <span className="mutedText"> ({total > 0 ? Math.round((b.amount / total) * 100) : 0}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LowStockWidget({ items, t }) {
  const lowStockItems = items.filter((i) => i.low_stock);
  if (lowStockItems.length === 0) return null;
  return (
    <div className={`card ${styles.widget} ${styles.alertCard}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.lowStock')}</h3>
      <ul className={styles.unloggedList}>
        {lowStockItems.map((i) => (
          <li key={i.product.id}>{i.product.name} — {i.current_stock} {unitLabel(i.product.unit_of_measure, t)}</li>
        ))}
      </ul>
    </div>
  );
}

// Smart Notifications (Part 3) — same widget shape as the ones above, each an
// in-app alert since no push/SMS infra exists (see dashboard.controller.js).
function HighOverdueWidget({ customers, t }) {
  if (customers.length === 0) return null;
  return (
    <div className={`card ${styles.widget} ${styles.alertCard}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.highOverdue')}</h3>
      <p className={styles.bigNumber}>{customers.length}</p>
      <ul className={styles.unloggedList}>
        {customers.slice(0, 5).map((c) => (
          <li key={c.id}>{c.name} — {formatCurrency(c.total_due)} ({t('dashboard.widgets.daysPending', { count: c.days_pending })})</li>
        ))}
      </ul>
    </div>
  );
}

function NewDeviceLoginsWidget({ logins, t }) {
  if (logins.length === 0) return null;
  return (
    <div className={`card ${styles.widget}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.newDeviceLogins')}</h3>
      <ul className={styles.unloggedList}>
        {logins.slice(0, 5).map((l, i) => (
          <li key={i}>{l.user_name} — {formatDate(l.created_at)}</li>
        ))}
      </ul>
    </div>
  );
}

function InactiveCustomerDeliveriesWidget({ entries, t }) {
  if (entries.length === 0) return null;
  return (
    <div className={`card ${styles.widget} ${styles.alertCard}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.inactiveCustomerDeliveries')}</h3>
      <ul className={styles.unloggedList}>
        {entries.slice(0, 5).map((e, i) => (
          <li key={i}>{e.customer_name} — {formatDate(e.created_at)}</li>
        ))}
      </ul>
    </div>
  );
}

function MonthlySummaryWidget({ available, onView, t }) {
  if (!available) return null;
  return (
    <div className={`card ${styles.widget}`}>
      <h3 className={styles.widgetTitle}>{t('dashboard.widgets.monthlySummaryReady')}</h3>
      <Button variant="secondary" onClick={onView}>{t('dashboard.widgets.viewSummary')}</Button>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const [preset, setPreset] = useState('past7Days');
  const [data, setData] = useState(null);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDashboard(computeDateRange(preset)).then(setData).finally(() => setLoading(false));
  }, [preset]);

  useEffect(() => { getStockSummary().then(setStock).catch(() => setStock([])); }, []);

  function shareSummaryToWhatsApp() {
    if (!data) return;
    const lines = [
      `${organization?.name || 'Delyver'} — ${t('dashboard.widgets.todaySummary')}`,
      `${t('dashboard.stats.todayOrders')}: ${data.stats.today_orders}`,
      `${t('dashboard.stats.todaySalesValue')}: ${formatCurrency(data.stats.today_sales_value)}`,
      `${t('dashboard.stats.todayCollected')}: ${formatCurrency(data.stats.today_collected)}`,
      // No route status for a vehicle_eod org (the server sends null) — see dashboard.controller.js.
      ...(data.route_status_today
        ? [`${t('dashboard.widgets.routeStatus')}: ${data.route_status_today.delivered}/${data.route_status_today.total} ${t('runSheet.status.delivered').toLowerCase()}`]
        : []),
    ];
    const text = lines.join('\n');
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
  }

  // First-login setup wizard: shown until the org admin finishes or
  // explicitly skips it (see OnboardingWizardPage.jsx / organizations.
  // onboarding_completed_at in schema.sql). Checked here rather than in
  // ProtectedRoute since this is specifically the landing page — a direct
  // link/bookmark to another admin page still works during onboarding.
  if (organization && !organization.onboarding_completed_at) {
    return <Navigate to="/admin/onboarding" replace />;
  }

  const statusChartData = data?.payment_status_breakdown.map((s) => ({
    name: t(`badges.${s.status}`),
    status: s.status,
    amount: s.amount,
    count: s.count,
  })) || [];

  const staffChartData = data?.today_by_staff.map((s) => ({ name: s.staff_name, orders: s.orders_count })) || [];
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const vehicleChartData = data?.today_by_vehicle?.map((v) => ({ name: v.vehicle_number, collected: v.collected, pending: v.pending })) || [];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('dashboard.title')}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={shareSummaryToWhatsApp} disabled={!data}>{t('dashboard.widgets.shareToWhatsApp')}</Button>
          <Select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ minWidth: 200 }}>
            {DATE_RANGE_PRESETS.map((p) => <option key={p} value={p}>{t(`dashboard.presets.${p}`)}</option>)}
          </Select>
        </div>
      </div>

      {loading || !data ? <Spinner /> : (
        <>
          <div className={styles.widgetRow}>
            {data.route_status_today && <RouteStatusWidget status={data.route_status_today} t={t} />}
            <PaymentModeWidget breakdown={data.payment_mode_breakdown_today} t={t} />
            {data.route_status_today && <UnloggedAlertWidget unlogged={data.unlogged_customers_today} t={t} />}
            <LowStockWidget items={stock} t={t} />
            <HighOverdueWidget customers={data.high_overdue_customers} t={t} />
            <NewDeviceLoginsWidget logins={data.recent_new_device_logins} t={t} />
            <InactiveCustomerDeliveriesWidget entries={data.recent_inactive_customer_deliveries} t={t} />
            <MonthlySummaryWidget available={data.monthly_summary_available} onView={() => setPreset('lastMonth')} t={t} />
          </div>

          <h2>{t('dashboard.periodStats')}</h2>
          <StatGrid>
            <StatCard label={t('dashboard.stats.orders')} value={data.stats.period_orders} />
            <StatCard label={t('dashboard.stats.salesValue')} value={formatCurrency(data.stats.period_sales_value)} />
            <StatCard label={t('dashboard.stats.collected')} value={formatCurrency(data.stats.period_collected)} />
            <StatCard label={t('dashboard.stats.pending')} value={formatCurrency(data.stats.period_pending)} />
          </StatGrid>

          <h2 style={{ marginTop: 24 }}>{t('dashboard.todayStats')}</h2>
          <StatGrid>
            <StatCard label={t('dashboard.stats.todayOrders')} value={data.stats.today_orders} />
            <StatCard label={t('dashboard.stats.todaySalesValue')} value={formatCurrency(data.stats.today_sales_value)} />
            <StatCard label={t('dashboard.stats.todayCollected')} value={formatCurrency(data.stats.today_collected)} />
          </StatGrid>

          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
            <ChartCard title={t('dashboard.charts.deliveriesCollections')}>
              <ResponsiveContainer>
                <LineChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={40} />
                  <Tooltip labelFormatter={shortDate} formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="sales_value" name={t('dashboard.stats.salesValue')} stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="collected" name={t('dashboard.stats.collected')} stroke="var(--chart-2)" strokeWidth={2.5} dot={false} strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t('dashboard.charts.paymentPending')}>
              <ResponsiveContainer>
                <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={40} />
                  <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={60}>
                    {statusChartData.map((entry) => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || 'var(--chart-1)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {vehicleOrg ? (
              <ChartCard title={t('dashboard.charts.todayByVehicle')}>
                <ResponsiveContainer>
                  <BarChart data={vehicleChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={40} />
                    <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="collected" name={t('dashboard.stats.collected')} stackId="vehicle" fill={STATUS_COLORS.paid} maxBarSize={60} />
                    <Bar dataKey="pending" name={t('dashboard.stats.pending')} stackId="vehicle" fill={STATUS_COLORS.pending} radius={[6, 6, 0, 0]} maxBarSize={60} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            ) : (
              <ChartCard title={t('dashboard.charts.todayByStaff')}>
                <ResponsiveContainer>
                  <BarChart data={staffChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={30} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
                    <Bar dataKey="orders" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={60} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
