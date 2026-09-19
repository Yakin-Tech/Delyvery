import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  fetchPlatformStats, fetchPlatformTimeseries, listOrganizations, listAuditLog,
  fetchActivityStats, fetchErrorStats, fetchTopOrgs,
} from '../../api/superAdmin.api';
import Spinner from '../../components/common/Spinner';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Table from '../../components/common/Table';
import { formatCurrency, formatDate, formatShortDate as shortDate } from '../../utils/paymentStatus';
import { ORG_STATUS_TONE, businessTypeLabel } from '../../utils/businessTypes';
import { describeAuditAction } from '../../utils/auditLog';


function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ marginBottom: 16 }}>{title}</h2>
      <div style={{ width: '100%', height: 260 }}>{children}</div>
    </div>
  );
}

export default function OverviewPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [recentOrgs, setRecentOrgs] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityStats, setActivityStats] = useState(null);
  const [errorStats, setErrorStats] = useState(null);
  const [topOrgs, setTopOrgs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchPlatformStats(),
      fetchPlatformTimeseries(),
      listOrganizations({ page_size: 5 }),
      listAuditLog({ page_size: 8 }),
      fetchActivityStats(),
      fetchErrorStats(),
      fetchTopOrgs(),
    ]).then(([statsData, timeseriesData, orgs, activity, activityData, errorData, topOrgsData]) => {
      setStats(statsData);
      setTimeseries(timeseriesData);
      setRecentOrgs(orgs.data);
      setRecentActivity(activity.data);
      setActivityStats(activityData);
      setErrorStats(errorData);
      setTopOrgs(topOrgsData);
    }).finally(() => setLoading(false));
  }, []);

  if (loading || !stats || !timeseries) return <Spinner />;

  const statusChartData = [
    { name: t('superAdmin.overview.active'), count: stats.organizations.active },
    { name: t('superAdmin.overview.trial'), count: stats.organizations.trial },
    { name: t('superAdmin.overview.suspended'), count: stats.organizations.suspended },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('superAdmin.overview.title')}</h1>
      </div>

      <h2>{t('superAdmin.overview.platformHealth')}</h2>
      <StatGrid>
        <StatCard label={t('superAdmin.overview.dau')} value={activityStats?.dau ?? '—'} />
        <StatCard label={t('superAdmin.overview.mau')} value={activityStats?.mau ?? '—'} />
        <StatCard label={t('superAdmin.overview.errors24h')} value={errorStats?.total_errors_24h ?? '—'} />
        <StatCard label={t('superAdmin.overview.inactiveOrgs')} value={activityStats?.inactive_orgs_7d.length ?? '—'} />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, marginTop: 24, marginBottom: 8 }}>
        <div>
          <h2>{t('superAdmin.overview.inactiveOrgsList')}</h2>
          <div className="card">
            {(!activityStats || activityStats.inactive_orgs_7d.length === 0) && <p className="mutedText">{t('superAdmin.overview.noInactiveOrgs')}</p>}
            {activityStats?.inactive_orgs_7d.map((org) => (
              <div key={org.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                <Link to={`/super-admin/organizations/${org.id}`}>{org.name}</Link>
                <Badge tone={ORG_STATUS_TONE[org.status]}>{org.status === 'active' ? t('common.active') : t(`badges.${org.status}`)}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>{t('superAdmin.overview.topOrgs')}</h2>
          <div className="card">
            <Table
              columns={[
                { key: 'organization_name', header: t('superAdmin.organizations.columns.org'), render: (r) => <Link to={`/super-admin/organizations/${r.organization_id}`}>{r.organization_name}</Link> },
                { key: 'deliveries_count', header: t('superAdmin.overview.deliveries') },
                { key: 'sales_value', header: t('superAdmin.overview.salesValue'), render: (r) => formatCurrency(r.sales_value) },
              ]}
              rows={topOrgs}
              rowKey={(r) => r.organization_id}
              emptyMessage={t('superAdmin.overview.noOrgs')}
            />
          </div>
        </div>
      </div>

      <h2>{t('superAdmin.overview.organizations')}</h2>
      <StatGrid>
        <StatCard label={t('superAdmin.overview.total')} value={stats.organizations.total} />
        <StatCard label={t('superAdmin.overview.active')} value={stats.organizations.active} />
        <StatCard label={t('superAdmin.overview.trial')} value={stats.organizations.trial} />
        <StatCard label={t('superAdmin.overview.suspended')} value={stats.organizations.suspended} />
      </StatGrid>

      <h2 style={{ marginTop: 24 }}>{t('superAdmin.overview.thisMonth')}</h2>
      <StatGrid>
        <StatCard label={t('superAdmin.overview.deliveries')} value={stats.this_month.deliveries_count} />
        <StatCard label={t('superAdmin.overview.salesValue')} value={formatCurrency(stats.this_month.sales_value)} />
        <StatCard label={t('superAdmin.overview.collected')} value={formatCurrency(stats.this_month.collected)} />
        <StatCard label={t('superAdmin.overview.totalCustomers')} value={stats.customers.total} />
      </StatGrid>

      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
        <ChartCard title={t('superAdmin.overview.deliveriesChart')}>
          <ResponsiveContainer>
            <LineChart data={timeseries.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} interval={4} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={40} />
              <Tooltip labelFormatter={shortDate} formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="sales_value" name={t('superAdmin.overview.salesValue')} stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="collected" name={t('superAdmin.overview.collected')} stroke="var(--chart-2)" strokeWidth={2.5} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('superAdmin.overview.orgStatusChart')}>
          <ResponsiveContainer>
            <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
              <Bar dataKey="count" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={60} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('superAdmin.overview.growthChart')}>
          <ResponsiveContainer>
            <LineChart data={timeseries.org_growth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={30} allowDecimals={false} />
              <Tooltip labelFormatter={shortDate} contentStyle={{ borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12 }} />
              <Line type="stepAfter" dataKey="cumulative_orgs" name={t('superAdmin.overview.organizations')} stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, marginTop: 8 }}>
        <div>
          <h2>{t('superAdmin.overview.recentOrgs')}</h2>
          <div className="card">
            {recentOrgs.length === 0 && <p className="mutedText">{t('superAdmin.overview.noOrgs')}</p>}
            {recentOrgs.map((org) => (
              <div key={org.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                <div>
                  <Link to={`/super-admin/organizations/${org.id}`}>{org.name}</Link>
                  <div className="mutedText">{businessTypeLabel(org.business_type, t)}</div>
                </div>
                <Badge tone={ORG_STATUS_TONE[org.status]}>{org.status === 'active' ? t('common.active') : t(`badges.${org.status}`)}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>{t('superAdmin.overview.recentActivity')}</h2>
          <div className="card">
            {recentActivity.length === 0 && <p className="mutedText">{t('superAdmin.overview.noActivity')}</p>}
            {recentActivity.map((entry) => (
              <div key={entry.id} style={{ padding: '8px 0' }}>
                <div>{describeAuditAction(entry, t)}</div>
                <div className="mutedText">{formatDate(entry.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
