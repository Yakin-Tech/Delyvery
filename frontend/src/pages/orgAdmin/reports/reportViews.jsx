import ChartCard from '../../../components/charts/ChartCard';
import DonutChart from '../../../components/charts/DonutChart';
import PeriodBars from '../../../components/charts/PeriodBars';
import CategoryBars from '../../../components/charts/CategoryBars';
import { PALETTE, STATUS_COLORS } from '../../../components/charts/chartTheme';
import { formatCurrency, formatDate, formatMonthLong, formatMonthName, formatMonthYear } from '../../../utils/paymentStatus';
import styles from './Reports.module.css';

// ---------------------------------------------------------------------------
// One "view" per report: what to show above the table (a row of headline
// numbers and one or more charts), the table's columns, and which controls
// change what the report contains. ReportsPage is generic over these.
//
//   control    'range'  — a date range          'days'  — inactivity threshold
//              'months' — how many months back  'years' — two years to compare
//              null     — nothing to choose (a snapshot of right now)
//   defaultRange, the preset a 'range' report opens on
//   filters    which extra filters the report offers, out of:
//              'groupBy' (day / week / month buckets)  'limit' (how many rows to keep)
//              'product'  'team' (vehicle, or staff on a route org)  'status'  'mode'
//   statusOptions  the payment statuses 'status' may pick from (default: all three)
//   teamLabel  'assigned' when 'team' means the customer's assigned vehicle / staff
//   kpis(rows, ctx)     -> [{ label, value }]
//   charts(rows, ctx)   -> JSX
//   columns(rows, ctx)  -> table columns
//   tableRows(rows)     -> the rows the table lists (default: all)
// ctx = { t, vehicleOrg, groupBy }
// ---------------------------------------------------------------------------

export const REPORT_GROUPS = [
  { key: 'overview', reports: ['sales-overview', 'collections', 'pending-aging', 'collection-efficiency'] },
  { key: 'sales', reports: ['product-sales', 'top-customers', 'year-over-year'] },
  { key: 'customers', reports: ['customer-inactivity', 'new-customer-acquisition', 'zone-performance'] },
  { key: 'team', reports: ['vehicle-performance', 'staff-productivity'] },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const sum = (rows, key) => rows.reduce((total, r) => total + (Number(r[key]) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;
const percent = (part, whole) => (whole > 0 ? `${round1((part / whole) * 100)}%` : '—');
const topBy = (rows, key) => rows.reduce((best, r) => (best === null || r[key] > best[key] ? r : best), null);
const daysSince = (dateStr) => Math.max(Math.floor((Date.now() - new Date(dateStr).getTime()) / DAY_MS), 0);

// What a day / week / month bucket is called in a table row or a KPI.
function bucketLabel(date, groupBy, t) {
  if (groupBy === 'month') return formatMonthLong(date);
  if (groupBy === 'week') return t('reports.weekOf', { date: formatDate(date) });
  return formatDate(date);
}

function Grid({ children }) {
  return <div className={styles.chartGrid}>{children}</div>;
}

// Adds a "share of the whole" slice list, folding the tail into one "other" slice
// so a donut never has a dozen slivers.
function topSlices(rows, nameOf, valueOf, otherLabel, limit = 5) {
  const sorted = [...rows].sort((a, b) => valueOf(b) - valueOf(a));
  const slices = sorted.slice(0, limit).map((r, i) => ({ name: nameOf(r), value: valueOf(r), color: PALETTE[i % PALETTE.length] }));
  const rest = sorted.slice(limit).reduce((total, r) => total + valueOf(r), 0);
  if (rest > 0) slices.push({ name: otherLabel, value: rest, color: PALETTE[PALETTE.length - 1] });
  return slices;
}

const withProductNames = (rows, t) => rows.map((r) => (r.product_id ? r : { ...r, product_name: t('reports.noProduct') }));

const AGING_COLORS = ['var(--chart-2)', '#7fb84a', 'var(--chart-5)', '#e0742b', 'var(--color-danger)', '#8f2d24', 'var(--chart-1)'];
const INACTIVITY_BUCKETS = [
  { key: 'under30', test: (days) => days < 30 },
  { key: 'd30to60', test: (days) => days >= 30 && days < 60 },
  { key: 'd60to90', test: (days) => days >= 60 && days < 90 },
  { key: 'over90', test: (days) => days >= 90 },
];

export const REPORT_VIEWS = {
  'sales-overview': {
    control: 'range',
    defaultRange: 'past1Month',
    filters: ['groupBy', 'product', 'team', 'status'],
    kpis: (rows, { t }) => {
      const value = sum(rows, 'sales_value');
      const collected = sum(rows, 'collected');
      const count = sum(rows, 'deliveries_count');
      return [
        { label: t('reports.kpi.salesValue'), value: formatCurrency(value) },
        { label: t('reports.kpi.collected'), value: formatCurrency(collected) },
        { label: t('reports.kpi.pending'), value: formatCurrency(value - collected) },
        { label: t('reports.kpi.deliveries'), value: count },
        { label: t('reports.kpi.avgOrder'), value: count > 0 ? formatCurrency(value / count) : '—' },
      ];
    },
    charts: (rows, { t, groupBy }) => (
      <Grid>
        <ChartCard title={t('reports.charts.salesVsCollected')} className={styles.wide}>
          <PeriodBars
            rows={rows}
            granularity={groupBy}
            format={formatCurrency}
            series={[
              { key: 'sales_value', name: t('reports.kpi.salesValue'), color: PALETTE[0] },
              { key: 'collected', name: t('reports.kpi.collected'), color: PALETTE[1] },
            ]}
          />
        </ChartCard>
        <ChartCard title={t('reports.charts.deliveryStatus')} height={200}>
          <DonutChart
            emptyLabel={t('reports.noData')}
            data={[
              { name: t('badges.paid'), value: sum(rows, 'paid_count'), color: STATUS_COLORS.paid },
              { name: t('badges.partial'), value: sum(rows, 'partial_count'), color: STATUS_COLORS.partial },
              { name: t('badges.pending'), value: sum(rows, 'pending_count'), color: STATUS_COLORS.pending },
            ]}
          />
        </ChartCard>
        <ChartCard title={t('reports.charts.deliveriesPerPeriod')} height={200}>
          <PeriodBars rows={rows} granularity={groupBy} series={[{ key: 'deliveries_count', name: t('reports.kpi.deliveries'), color: PALETTE[3] }]} />
        </ChartCard>
      </Grid>
    ),
    columns: (rows, { t, groupBy }) => [
      { key: 'date', header: groupBy === 'day' ? t('reports.columns.date') : t('reports.columns.period'), render: (r) => bucketLabel(r.date, groupBy, t) },
      { key: 'deliveries_count', header: t('reports.columns.deliveries') },
      { key: 'sales_value', header: t('reports.columns.salesValue'), render: (r) => formatCurrency(r.sales_value) },
      { key: 'collected', header: t('reports.columns.collected'), render: (r) => formatCurrency(r.collected) },
      { key: 'pending', header: t('reports.columns.pending'), render: (r) => formatCurrency(r.pending) },
      { key: 'paid_count', header: t('badges.paid') },
      { key: 'partial_count', header: t('badges.partial') },
      { key: 'pending_count', header: t('badges.pending') },
    ],
    tableRows: (rows) => rows.filter((r) => r.deliveries_count > 0).reverse(),
    rowKey: (r) => r.date,
  },

  collections: {
    control: 'range',
    defaultRange: 'past1Month',
    filters: ['groupBy', 'mode', 'team'],
    kpis: (rows, { t, groupBy }) => {
      const total = sum(rows, 'amount');
      const count = sum(rows, 'payments_count');
      const best = topBy(rows, 'amount');
      return [
        { label: t('reports.kpi.received'), value: formatCurrency(total) },
        { label: t('reports.kpi.payments'), value: count },
        { label: t('reports.kpi.avgPayment'), value: count > 0 ? formatCurrency(total / count) : '—' },
        { label: groupBy === 'day' ? t('reports.kpi.bestDay') : t('reports.kpi.bestPeriod'), value: best && best.amount > 0 ? `${formatCurrency(best.amount)} · ${bucketLabel(best.date, groupBy, t)}` : '—' },
      ];
    },
    charts: (rows, { t, groupBy }) => (
      <Grid>
        <ChartCard title={t('reports.charts.receivedOverTime')} className={styles.wide}>
          <PeriodBars rows={rows} granularity={groupBy} format={formatCurrency} series={[{ key: 'amount', name: t('reports.kpi.received'), color: PALETTE[1] }]} />
        </ChartCard>
        <ChartCard title={t('reports.charts.byPaymentMode')} height={200} className={styles.wide}>
          <DonutChart
            format={formatCurrency}
            emptyLabel={t('reports.noData')}
            data={['cash', 'upi', 'bank_transfer', 'card', 'other'].map((mode, i) => ({ name: t(`paymentModes.${mode}`), value: sum(rows, mode), color: PALETTE[i] }))}
          />
        </ChartCard>
      </Grid>
    ),
    columns: (rows, { t, groupBy }) => [
      { key: 'date', header: groupBy === 'day' ? t('reports.columns.date') : t('reports.columns.period'), render: (r) => bucketLabel(r.date, groupBy, t) },
      { key: 'payments_count', header: t('reports.columns.payments') },
      { key: 'amount', header: t('reports.columns.amount'), render: (r) => <strong>{formatCurrency(r.amount)}</strong> },
      { key: 'cash', header: t('paymentModes.cash'), render: (r) => formatCurrency(r.cash) },
      { key: 'upi', header: t('paymentModes.upi'), render: (r) => formatCurrency(r.upi) },
      { key: 'bank_transfer', header: t('paymentModes.bank_transfer'), render: (r) => formatCurrency(r.bank_transfer) },
      { key: 'card', header: t('paymentModes.card'), render: (r) => formatCurrency(r.card) },
      { key: 'other', header: t('paymentModes.other'), render: (r) => formatCurrency(r.other) },
    ],
    tableRows: (rows) => rows.filter((r) => r.payments_count > 0).reverse(),
    rowKey: (r) => r.date,
  },

  'pending-aging': {
    control: null,
    filters: ['product', 'team', 'status'],
    statusOptions: ['pending', 'partial'],
    kpis: (rows, { t }) => {
      const total = sum(rows, 'amount');
      const over30 = rows.filter((r) => ['31-60', '61-90', '90+'].includes(r.bucket)).reduce((s, r) => s + r.amount, 0);
      return [
        { label: t('reports.kpi.totalPending'), value: formatCurrency(total) },
        { label: t('reports.kpi.openDeliveries'), value: sum(rows, 'deliveries_count') },
        { label: t('reports.kpi.over30Days'), value: formatCurrency(over30) },
        { label: t('reports.kpi.over30Share'), value: percent(over30, total) },
      ];
    },
    charts: (rows, { t }) => {
      const labelled = rows.map((r, i) => ({ ...r, label: t(`reports.aging.${r.bucket}`), color: AGING_COLORS[i % AGING_COLORS.length] }));
      return (
        <Grid>
          <ChartCard title={t('reports.charts.pendingByAge')}>
            <CategoryBars data={labelled} categoryKey="label" format={formatCurrency} horizontal categoryWidth={120} colors={AGING_COLORS} series={[{ key: 'amount', name: t('reports.columns.amount'), color: PALETTE[0] }]} />
          </ChartCard>
          <ChartCard title={t('reports.charts.pendingShare')}>
            <DonutChart format={formatCurrency} emptyLabel={t('reports.noData')} data={labelled.map((r) => ({ name: r.label, value: r.amount, color: r.color }))} />
          </ChartCard>
        </Grid>
      );
    },
    columns: (rows, { t }) => {
      const total = sum(rows, 'amount');
      return [
        { key: 'bucket', header: t('reports.columns.age'), render: (r) => <strong>{t(`reports.aging.${r.bucket}`)}</strong> },
        { key: 'deliveries_count', header: t('reports.columns.openDeliveries') },
        { key: 'customers_count', header: t('reports.columns.customers') },
        { key: 'amount', header: t('reports.columns.amount'), render: (r) => formatCurrency(r.amount) },
        { key: 'share', header: t('reports.columns.share'), render: (r) => percent(r.amount, total) },
      ];
    },
    rowKey: (r) => r.bucket,
  },

  'collection-efficiency': {
    control: 'range',
    defaultRange: 'last3Months',
    filters: ['product', 'team'],
    note: 'reports.collectionEfficiencyNote',
    kpis: (rows, { t }) => {
      const row = rows[0] || {};
      return [
        { label: t('reports.kpi.deliveries'), value: row.total_deliveries ?? 0 },
        { label: t('reports.kpi.paidSameDay'), value: `${row.paid_same_day_pct ?? 0}%` },
        { label: t('reports.kpi.paidLater'), value: row.paid_later ?? 0 },
        { label: t('reports.kpi.stillPending'), value: row.still_pending ?? 0 },
      ];
    },
    charts: (rows, { t }) => {
      const row = rows[0] || {};
      return (
        <Grid>
          <ChartCard title={t('reports.charts.howPaid')} height={220} className={styles.wide}>
            <DonutChart
              emptyLabel={t('reports.noData')}
              data={[
                { name: t('reports.columns.paidSameDay'), value: row.paid_same_day || 0, color: STATUS_COLORS.paid },
                { name: t('reports.columns.paidLater'), value: row.paid_later || 0, color: STATUS_COLORS.partial },
                { name: t('badges.pending'), value: row.still_pending || 0, color: STATUS_COLORS.pending },
              ]}
            />
          </ChartCard>
        </Grid>
      );
    },
    columns: (rows, { t }) => [
      { key: 'total_deliveries', header: t('reports.columns.totalDeliveries') },
      { key: 'paid_same_day', header: t('reports.columns.paidSameDay') },
      { key: 'paid_later', header: t('reports.columns.paidLater') },
      { key: 'still_pending', header: t('badges.pending') },
      { key: 'paid_same_day_pct', header: t('reports.columns.paidSameDayPct'), render: (r) => `${r.paid_same_day_pct}%` },
    ],
    rowKey: () => 'row',
  },

  'product-sales': {
    control: 'range',
    defaultRange: 'last3Months',
    filters: ['team', 'status'],
    kpis: (rows, { t }) => {
      const top = topBy(withProductNames(rows, t), 'sales_value');
      return [
        { label: t('reports.kpi.salesValue'), value: formatCurrency(sum(rows, 'sales_value')) },
        { label: t('reports.kpi.products'), value: rows.length },
        { label: t('reports.kpi.deliveries'), value: sum(rows, 'deliveries_count') },
        { label: t('reports.kpi.topProduct'), value: top ? top.product_name : '—' },
      ];
    },
    charts: (allRows, { t }) => {
      const rows = withProductNames(allRows, t);
      return (
      <Grid>
        <ChartCard title={t('reports.charts.salesByProduct')}>
          <CategoryBars data={rows.slice(0, 8)} categoryKey="product_name" format={formatCurrency} horizontal colors={PALETTE} series={[{ key: 'sales_value', name: t('reports.kpi.salesValue'), color: PALETTE[0] }]} />
        </ChartCard>
        <ChartCard title={t('reports.charts.productShare')}>
          <DonutChart format={formatCurrency} emptyLabel={t('reports.noData')} data={topSlices(rows, (r) => r.product_name, (r) => r.sales_value, t('reports.other'))} />
        </ChartCard>
      </Grid>
      );
    },
    columns: (rows, { t }) => [
      { key: 'product_name', header: t('common.product'), render: (r) => (r.product_id ? r.product_name : t('reports.noProduct')) },
      { key: 'quantity', header: t('reports.columns.quantity') },
      { key: 'sales_value', header: t('reports.columns.salesValue'), render: (r) => formatCurrency(r.sales_value) },
      { key: 'deliveries_count', header: t('reports.columns.deliveries') },
    ],
    rowKey: (r) => r.product_id || 'none',
  },

  'top-customers': {
    control: 'range',
    defaultRange: 'thisYear',
    filters: ['limit', 'product', 'team', 'status'],
    kpis: (rows, { t }) => {
      const total = sum(rows, 'revenue');
      const top = rows[0];
      return [
        { label: t('reports.kpi.revenue'), value: formatCurrency(total) },
        { label: t('reports.kpi.customers'), value: rows.length },
        { label: t('reports.kpi.avgRevenue'), value: rows.length > 0 ? formatCurrency(total / rows.length) : '—' },
        { label: t('reports.kpi.topCustomer'), value: top ? top.customer_name : '—' },
      ];
    },
    charts: (rows, { t }) => (
      <Grid>
        <ChartCard title={t('reports.charts.topCustomers')} height={Math.max(220, Math.min(rows.length, 10) * 34)} className={styles.wide}>
          <CategoryBars data={rows.slice(0, 10)} categoryKey="customer_name" format={formatCurrency} horizontal categoryWidth={140} series={[{ key: 'revenue', name: t('reports.columns.revenue'), color: PALETTE[0] }]} />
        </ChartCard>
      </Grid>
    ),
    columns: (rows, { t }) => [
      { key: 'rank', header: '#', render: (r) => rows.indexOf(r) + 1 },
      { key: 'customer_name', header: t('customers.columns.name') },
      { key: 'revenue', header: t('reports.columns.revenue'), render: (r) => <strong>{formatCurrency(r.revenue)}</strong> },
      { key: 'deliveries_count', header: t('reports.columns.deliveries') },
    ],
    rowKey: (r) => r.customer_id,
  },

  'year-over-year': {
    control: 'years',
    filters: ['product', 'team'],
    kpis: (rows, { t }) => {
      const keys = rows[0] ? Object.keys(rows[0]).filter((k) => k.startsWith('sales_')) : [];
      const [a, b] = keys;
      const totalA = a ? sum(rows, a) : 0;
      const totalB = b ? sum(rows, b) : 0;
      return [
        { label: a ? t('reports.kpi.salesYear', { year: a.slice('sales_'.length) }) : '—', value: formatCurrency(totalA) },
        { label: b ? t('reports.kpi.salesYear', { year: b.slice('sales_'.length) }) : '—', value: formatCurrency(totalB) },
        { label: t('reports.kpi.change'), value: totalA > 0 ? `${totalB >= totalA ? '+' : ''}${round1(((totalB - totalA) / totalA) * 100)}%` : '—' },
      ];
    },
    charts: (rows, { t }) => {
      const keys = rows[0] ? Object.keys(rows[0]).filter((k) => k.startsWith('sales_')) : [];
      const data = rows.map((r) => ({ ...r, label: formatMonthName(r.month) }));
      return (
        <Grid>
          <ChartCard title={t('reports.charts.monthlySales')} className={styles.wide}>
            <CategoryBars data={data} categoryKey="label" format={formatCurrency} series={keys.map((key, i) => ({ key, name: key.slice('sales_'.length), color: PALETTE[i === 0 ? 5 : 0] }))} />
          </ChartCard>
        </Grid>
      );
    },
    columns: (rows, { t }) => {
      const keys = rows[0] ? Object.keys(rows[0]) : ['month'];
      return keys.map((key) => ({
        key,
        header: key === 'month'
          ? t('reports.columns.month')
          : (key.startsWith('sales_') ? t('reports.columns.salesYear', { year: key.slice('sales_'.length) }) : t('reports.columns.deliveriesYear', { year: key.slice('deliveries_'.length) })),
        render: key === 'month' ? (r) => formatMonthName(r.month) : (key.startsWith('sales_') ? (r) => formatCurrency(r[key]) : undefined),
      }));
    },
    rowKey: (r) => r.month,
  },

  'customer-inactivity': {
    control: 'days',
    filters: ['team'],
    teamLabel: 'assigned',
    kpis: (rows, { t }) => {
      const days = rows.filter((r) => r.last_delivery_date).map((r) => daysSince(r.last_delivery_date));
      return [
        { label: t('reports.kpi.inactiveCustomers'), value: rows.length },
        { label: t('reports.kpi.neverDelivered'), value: rows.filter((r) => !r.last_delivery_date).length },
        { label: t('reports.kpi.longestInactive'), value: days.length > 0 ? t('reports.kpi.daysValue', { count: Math.max(...days) }) : '—' },
      ];
    },
    charts: (rows, { t }) => {
      const buckets = INACTIVITY_BUCKETS.map((b) => ({
        label: t(`reports.inactivity.${b.key}`),
        customers: rows.filter((r) => r.last_delivery_date && b.test(daysSince(r.last_delivery_date))).length,
      }));
      buckets.push({ label: t('reports.inactivity.never'), customers: rows.filter((r) => !r.last_delivery_date).length });
      return (
        <Grid>
          <ChartCard title={t('reports.charts.inactivityBuckets')} className={styles.wide} height={220}>
            <CategoryBars data={buckets} categoryKey="label" colors={AGING_COLORS} series={[{ key: 'customers', name: t('reports.columns.customers'), color: PALETTE[0] }]} />
          </ChartCard>
        </Grid>
      );
    },
    columns: (rows, { t, vehicleOrg }) => [
      { key: 'customer_name', header: t('customers.columns.name') },
      { key: 'phone', header: t('common.phone') },
      ...(vehicleOrg ? [] : [{ key: 'assigned_staff_name', header: t('customers.columns.staff') }]),
      { key: 'last_delivery_date', header: t('reports.columns.lastDeliveryDate'), render: (r) => (r.last_delivery_date ? formatDate(r.last_delivery_date) : t('reports.never')) },
      { key: 'days', header: t('reports.columns.daysInactive'), render: (r) => (r.last_delivery_date ? daysSince(r.last_delivery_date) : '—') },
    ],
    rowKey: (r) => r.customer_id,
  },

  'new-customer-acquisition': {
    control: 'months',
    filters: ['team'],
    teamLabel: 'assigned',
    kpis: (rows, { t }) => {
      const total = sum(rows, 'new_customers');
      const best = topBy(rows, 'new_customers');
      return [
        { label: t('reports.kpi.newCustomers'), value: total },
        { label: t('reports.kpi.avgPerMonth'), value: rows.length > 0 ? round1(total / rows.length) : '—' },
        { label: t('reports.kpi.bestMonth'), value: best ? `${formatMonthYear(`${best.month}-01`)} · ${best.new_customers}` : '—' },
      ];
    },
    charts: (rows, { t }) => (
      <Grid>
        <ChartCard title={t('reports.charts.newCustomersByMonth')} className={styles.wide} height={240}>
          <CategoryBars data={rows.map((r) => ({ ...r, label: formatMonthYear(`${r.month}-01`) }))} categoryKey="label" series={[{ key: 'new_customers', name: t('reports.columns.newCustomers'), color: PALETTE[1] }]} />
        </ChartCard>
      </Grid>
    ),
    columns: (rows, { t }) => [
      { key: 'month', header: t('reports.columns.month'), render: (r) => formatMonthYear(`${r.month}-01`) },
      { key: 'new_customers', header: t('reports.columns.newCustomers') },
    ],
    rowKey: (r) => r.month,
  },

  'zone-performance': {
    control: null,
    filters: [],
    note: 'reports.zoneLimitation',
    kpis: (rows, { t }) => {
      const top = topBy(rows, 'total_pending');
      return [
        { label: t('reports.kpi.totalPending'), value: formatCurrency(sum(rows, 'total_pending')) },
        { label: t('reports.kpi.zones'), value: rows.length },
        { label: t('reports.kpi.customers'), value: sum(rows, 'customer_count') },
        { label: t('reports.kpi.topZone'), value: top ? (top.zone === 'Unassigned' ? t('reports.unassigned') : top.zone) : '—' },
      ];
    },
    charts: (rows, { t }) => {
      const named = rows.map((r) => ({ ...r, label: r.zone === 'Unassigned' ? t('reports.unassigned') : r.zone }));
      return (
        <Grid>
          <ChartCard title={t('reports.charts.pendingByZone')}>
            <CategoryBars data={named} categoryKey="label" format={formatCurrency} colors={PALETTE} series={[{ key: 'total_pending', name: t('customers.columns.pending'), color: PALETTE[0] }]} />
          </ChartCard>
          <ChartCard title={t('reports.charts.zoneShare')}>
            <DonutChart format={formatCurrency} emptyLabel={t('reports.noData')} data={topSlices(named, (r) => r.label, (r) => r.total_pending, t('reports.other'))} />
          </ChartCard>
        </Grid>
      );
    },
    columns: (rows, { t }) => [
      { key: 'zone', header: t('reports.columns.zone'), render: (r) => (r.zone === 'Unassigned' ? t('reports.unassigned') : r.zone) },
      { key: 'customer_count', header: t('reports.columns.customers') },
      { key: 'total_pending', header: t('customers.columns.pending'), render: (r) => formatCurrency(r.total_pending) },
    ],
    rowKey: (r) => r.zone,
  },

  'vehicle-performance': {
    control: 'range',
    defaultRange: 'last3Months',
    filters: ['product', 'team'],
    kpis: (rows, { t }) => {
      const value = sum(rows, 'total_value');
      const collected = sum(rows, 'total_collected');
      return [
        { label: t('reports.kpi.vehicles'), value: rows.length },
        { label: t('reports.kpi.salesValue'), value: formatCurrency(value) },
        { label: t('reports.kpi.collected'), value: formatCurrency(collected) },
        { label: t('reports.kpi.collectionRate'), value: percent(collected, value) },
      ];
    },
    charts: (rows, { t }) => (
      <Grid>
        <ChartCard title={t('reports.charts.valueByVehicle')}>
          <CategoryBars
            data={rows}
            categoryKey="vehicle_number"
            format={formatCurrency}
            series={[
              { key: 'total_value', name: t('reports.kpi.salesValue'), color: PALETTE[0] },
              { key: 'total_collected', name: t('reports.kpi.collected'), color: PALETTE[1] },
            ]}
          />
        </ChartCard>
        <ChartCard title={t('reports.charts.vehicleShare')}>
          <DonutChart format={formatCurrency} emptyLabel={t('reports.noData')} data={topSlices(rows, (r) => r.vehicle_number, (r) => r.total_value, t('reports.other'))} />
        </ChartCard>
      </Grid>
    ),
    columns: (rows, { t }) => [
      { key: 'vehicle_number', header: t('reports.columns.vehicle'), render: (r) => <strong>{r.vehicle_number}</strong> },
      { key: 'driver_name', header: t('reports.columns.driver'), render: (r) => r.driver_name || '—' },
      { key: 'total_deliveries', header: t('reports.columns.deliveries') },
      { key: 'total_value', header: t('reports.columns.totalValue'), render: (r) => formatCurrency(r.total_value) },
      { key: 'total_collected', header: t('reports.columns.collected'), render: (r) => formatCurrency(r.total_collected) },
      { key: 'total_pending', header: t('reports.columns.pending'), render: (r) => formatCurrency(r.total_pending) },
      { key: 'collection_rate_pct', header: t('reports.columns.avgCollectionRate'), render: (r) => `${r.collection_rate_pct}%` },
      { key: 'days_active', header: t('reports.columns.daysActive') },
    ],
    rowKey: (r) => r.vehicle_id,
  },

  'staff-productivity': {
    control: 'range',
    defaultRange: 'last3Months',
    filters: ['team'],
    kpis: (rows, { t }) => {
      const top = topBy(rows, 'deliveries_per_hour');
      return [
        { label: t('reports.kpi.staff'), value: rows.length },
        { label: t('reports.kpi.avgDeliveriesPerHour'), value: rows.length > 0 ? round1(sum(rows, 'deliveries_per_hour') / rows.length) : '—' },
        { label: t('reports.kpi.avgCollectionRate'), value: rows.length > 0 ? `${round1(sum(rows, 'avg_collection_rate_pct') / rows.length)}%` : '—' },
        { label: t('reports.kpi.topStaff'), value: top ? top.staff_name : '—' },
      ];
    },
    charts: (rows, { t }) => (
      <Grid>
        <ChartCard title={t('reports.charts.deliveriesPerHour')}>
          <CategoryBars data={rows} categoryKey="staff_name" colors={PALETTE} series={[{ key: 'deliveries_per_hour', name: t('reports.columns.deliveriesPerHour'), color: PALETTE[0] }]} />
        </ChartCard>
        <ChartCard title={t('reports.charts.collectionRateByStaff')}>
          <CategoryBars data={rows} categoryKey="staff_name" format={(v) => `${v}%`} series={[{ key: 'avg_collection_rate_pct', name: t('reports.columns.avgCollectionRate'), color: PALETTE[1] }]} />
        </ChartCard>
      </Grid>
    ),
    columns: (rows, { t }) => [
      { key: 'staff_name', header: t('customers.columns.staff') },
      { key: 'deliveries_per_hour', header: t('reports.columns.deliveriesPerHour') },
      { key: 'avg_collection_rate_pct', header: t('reports.columns.avgCollectionRate'), render: (r) => `${r.avg_collection_rate_pct}%` },
      { key: 'days_active', header: t('reports.columns.daysActive') },
    ],
    rowKey: (r) => r.staff_id,
  },
};
