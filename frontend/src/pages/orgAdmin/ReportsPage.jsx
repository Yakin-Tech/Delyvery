import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getReport, exportReportCsv, reportNamesFor } from '../../api/reports.api';
import { listProducts } from '../../api/products.api';
import { listVehicles } from '../../api/vehicles.api';
import { listStaff } from '../../api/staff.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/common/Button';
import Select from '../../components/common/Select';
import Spinner from '../../components/common/Spinner';
import StatCard, { StatGrid } from '../../components/common/StatCard';
import Table from '../../components/common/Table';
import TextInput from '../../components/common/TextInput';
import { REPORT_RANGE_PRESETS, computeDateRange } from '../../utils/dateRanges';
import { formatDate } from '../../utils/paymentStatus';
import { REPORT_GROUPS, REPORT_VIEWS } from './reports/reportViews';
import styles from './ReportsPage.module.css';

const DAY_OPTIONS = [7, 14, 30, 60, 90];
const MONTH_OPTIONS = [6, 12, 24];
const LIMIT_OPTIONS = [10, 20, 50, 100];
const GROUP_OPTIONS = ['auto', 'day', 'week', 'month'];
const PAYMENT_STATUSES = ['paid', 'partial', 'pending'];
const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other'];
const DAY_MS = 24 * 60 * 60 * 1000;

// The filters a report can have besides its period, and what they start as.
const NO_FILTERS = { product: '', team: '', status: '', mode: '', groupBy: 'auto', limit: '20' };
const FIRST_ROW_FILTERS = ['groupBy', 'limit'];
const SECOND_ROW_FILTERS = ['product', 'team', 'status', 'mode'];

// "Automatic" grouping: days for a few months, weeks for up to a year or so, months beyond.
function resolveGroupBy(choice, { date_from: from, date_to: to }) {
  if (choice !== 'auto') return choice;
  const days = from && to ? (Date.parse(to) - Date.parse(from)) / DAY_MS + 1 : 30;
  if (!(days > 92)) return 'day';
  return days <= 400 ? 'week' : 'month';
}

// The reports hub: pick a report on the left, choose its period and filters, and read it
// as headline numbers, charts and a table. Every report can be exported, printed or shared,
// and the export and the printout carry the same filters as the screen.
export default function ReportsPage() {
  const { t } = useTranslation();
  const { organization } = useAuth();
  const vehicleOrg = organization?.delivery_model === 'vehicle_eod';
  const available = useMemo(() => reportNamesFor(organization), [organization]);
  const groups = useMemo(
    () => REPORT_GROUPS.map((g) => ({ ...g, reports: g.reports.filter((name) => available.includes(name)) })).filter((g) => g.reports.length > 0),
    [available],
  );

  const [reportName, setReportName] = useState(groups[0].reports[0]);
  const view = REPORT_VIEWS[reportName];
  const viewFilters = useMemo(
    () => (view.filters || []).filter((key) => key !== 'product' || organization?.products_enabled),
    [view, organization],
  );

  const thisYear = new Date().getFullYear();
  const defaultRange = view.defaultRange || 'past1Month';
  const [range, setRange] = useState(defaultRange);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [days, setDays] = useState('14');
  const [months, setMonths] = useState('12');
  const [yearA, setYearA] = useState(String(thisYear - 1));
  const [yearB, setYearB] = useState(String(thisYear));
  const [filters, setFilters] = useState(NO_FILTERS);

  const [products, setProducts] = useState([]);
  const [teamOptions, setTeamOptions] = useState([]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  // The choices behind the product and vehicle / staff filters.
  useEffect(() => {
    let cancelled = false;
    if (organization?.products_enabled) {
      listProducts({ page_size: 100, include_inactive: true })
        .then((result) => { if (!cancelled) setProducts(result.data.map((p) => ({ id: p.id, label: p.name }))); })
        .catch(() => {});
    }
    const team = vehicleOrg
      ? listVehicles({ page_size: 100 }).then((result) => result.data.map((v) => ({ id: v.id, label: v.driver_name ? `${v.vehicle_number} · ${v.driver_name}` : v.vehicle_number })))
      : listStaff({ page_size: 100 }).then((result) => result.data.map((s) => ({ id: s.id, label: s.name })));
    team.then((options) => { if (!cancelled) setTeamOptions(options); }).catch(() => {});
    return () => { cancelled = true; };
  }, [vehicleOrg, organization?.products_enabled]);

  // The period the current controls ask for.
  const periodParams = useMemo(() => {
    switch (view.control) {
      case 'range': {
        if (range === 'custom') return { date_from: customFrom || undefined, date_to: customTo || undefined };
        return computeDateRange(range);
      }
      case 'days': return { days };
      case 'months': return { months };
      case 'years': return { year_a: yearA, year_b: yearB };
      default: return {};
    }
  }, [view.control, range, customFrom, customTo, days, months, yearA, yearB]);

  const groupBy = viewFilters.includes('groupBy') ? resolveGroupBy(filters.groupBy, periodParams) : 'day';

  // Everything the server is asked for: the period plus whichever filters this report has.
  const params = useMemo(() => {
    const p = { ...periodParams };
    if (viewFilters.includes('groupBy')) p.group_by = groupBy;
    if (viewFilters.includes('limit')) p.limit = filters.limit;
    if (viewFilters.includes('product') && filters.product) p.product_id = filters.product;
    if (viewFilters.includes('team') && filters.team) p[vehicleOrg ? 'vehicle_id' : 'staff_id'] = filters.team;
    if (viewFilters.includes('status') && filters.status) p.payment_status = filters.status;
    if (viewFilters.includes('mode') && filters.mode) p.payment_mode = filters.mode;
    return p;
  }, [periodParams, viewFilters, groupBy, filters, vehicleOrg]);

  useEffect(() => {
    const mine = ++requestId.current;
    setLoading(true);
    setError('');
    getReport(reportName, params)
      .then((data) => { if (mine === requestId.current) setRows(data); })
      .catch((err) => { if (mine === requestId.current) { setRows([]); setError(err.message); } })
      .finally(() => { if (mine === requestId.current) setLoading(false); });
  }, [reportName, params]);

  function selectReport(name) {
    if (name === reportName) return;
    setRows([]);
    setReportName(name);
    setRange(REPORT_VIEWS[name].defaultRange || 'past1Month');
    // Product and vehicle / staff mean the same on every report, so they carry over;
    // the rest are specific to a report and start fresh.
    setFilters((f) => ({ ...f, status: '', mode: '', limit: NO_FILTERS.limit }));
  }

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function clearFilters() {
    setRange(defaultRange);
    setCustomFrom('');
    setCustomTo('');
    setDays('14');
    setMonths('12');
    setYearA(String(thisYear - 1));
    setYearB(String(thisYear));
    setFilters(NO_FILTERS);
  }

  const isFiltered = (view.control === 'range' && (range !== defaultRange || customFrom !== '' || customTo !== ''))
    || (view.control === 'days' && days !== '14')
    || (view.control === 'months' && months !== '12')
    || (view.control === 'years' && (yearA !== String(thisYear - 1) || yearB !== String(thisYear)))
    || viewFilters.some((key) => filters[key] !== NO_FILTERS[key]);

  const ctx = { t, vehicleOrg, groupBy };
  const kpis = loading ? [] : view.kpis(rows, ctx);
  const tableRows = view.tableRows ? view.tableRows(rows) : rows;

  // ---- what the filters are called, and what they are set to -------------
  const groupLabels = {
    auto: t('reports.controls.groupAuto'),
    day: t('reports.controls.groupDay'),
    week: t('reports.controls.groupWeek'),
    month: t('reports.controls.groupMonth'),
  };
  const statusLabels = {
    paid: t('deliveries.filters.paid'),
    partial: t('deliveries.filters.partial'),
    pending: t('deliveries.filters.pending'),
  };
  const statusChoices = view.statusOptions || PAYMENT_STATUSES;
  const assignedTeam = view.teamLabel === 'assigned';
  const teamLabel = assignedTeam
    ? (vehicleOrg ? t('customers.detail.assignedVehicle') : t('customers.detail.assignedStaff'))
    : (vehicleOrg ? t('deliveries.filters.vehicle') : t('deliveries.filters.staff'));
  const labelOf = (options, id) => options.find((o) => o.id === id)?.label || '';

  function periodSummary() {
    switch (view.control) {
      case 'range': {
        const { date_from: from, date_to: to } = periodParams;
        return `${t('reports.controls.period')}: ${from ? formatDate(from) : '…'} – ${to ? formatDate(to) : '…'}`;
      }
      case 'days': return `${t('reports.controls.noDeliveryFor')}: ${t('reports.controls.daysOrMore', { count: Number(days) })}`;
      case 'months': return `${t('reports.controls.lookBack')}: ${t('reports.controls.lastMonths', { count: Number(months) })}`;
      case 'years': return `${t('reports.controls.compare')}: ${yearA} / ${yearB}`;
      default: return '';
    }
  }

  // "Period: 1 Sep 2026 – 19 Sep 2026 · Vehicle: KA01AB1234 · …" — printed above the report
  // and put at the top of a shared summary, so a page taken out of the app says what it covers.
  const summary = [
    periodSummary(),
    viewFilters.includes('groupBy') && `${t('reports.controls.groupBy')}: ${groupLabels[groupBy]}`,
    viewFilters.includes('limit') && t('reports.controls.topN', { count: Number(filters.limit) }),
    viewFilters.includes('product') && filters.product && `${t('common.product')}: ${labelOf(products, filters.product)}`,
    viewFilters.includes('team') && filters.team && `${teamLabel}: ${labelOf(teamOptions, filters.team)}`,
    viewFilters.includes('status') && filters.status && `${t('deliveries.filters.paymentStatus')}: ${statusLabels[filters.status]}`,
    viewFilters.includes('mode') && filters.mode && `${t('deliveries.modal.paymentMode')}: ${t(`paymentModes.${filters.mode}`)}`,
  ].filter(Boolean).join(' · ');

  function handleShare() {
    const lines = kpis.map((k) => `${k.label}: ${k.value}`);
    const text = `${organization?.name || 'Delyver'} — ${t(`reports.names.${reportName}`)}\n${summary}\n${lines.join('\n') || t('reports.empty')}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  const yearOptions = Array.from({ length: 6 }, (_, i) => String(thisYear - i));

  function renderFilter(key) {
    switch (key) {
      case 'groupBy':
        return (
          <Select key={key} label={t('reports.controls.groupBy')} value={filters.groupBy} onChange={(e) => setFilter('groupBy', e.target.value)}>
            {GROUP_OPTIONS.map((g) => <option key={g} value={g}>{groupLabels[g]}</option>)}
          </Select>
        );
      case 'limit':
        return (
          <Select key={key} label={t('reports.controls.showTop')} value={filters.limit} onChange={(e) => setFilter('limit', e.target.value)}>
            {LIMIT_OPTIONS.map((n) => <option key={n} value={String(n)}>{t('reports.controls.topN', { count: n })}</option>)}
          </Select>
        );
      case 'product':
        return (
          <Select key={key} label={t('common.product')} value={filters.product} onChange={(e) => setFilter('product', e.target.value)}>
            <option value="">{t('deliveries.filters.allProducts')}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        );
      case 'team':
        return (
          <Select key={key} label={teamLabel} value={filters.team} onChange={(e) => setFilter('team', e.target.value)}>
            <option value="">{vehicleOrg ? t('deliveries.filters.allVehicles') : t('deliveries.filters.allStaff')}</option>
            {teamOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        );
      case 'status':
        return (
          <Select key={key} label={t('deliveries.filters.paymentStatus')} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">{t('deliveries.filters.allStatuses')}</option>
            {statusChoices.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
          </Select>
        );
      case 'mode':
        return (
          <Select key={key} label={t('deliveries.modal.paymentMode')} value={filters.mode} onChange={(e) => setFilter('mode', e.target.value)}>
            <option value="">{t('reports.controls.allModes')}</option>
            {PAYMENT_MODES.map((m) => <option key={m} value={m}>{t(`paymentModes.${m}`)}</option>)}
          </Select>
        );
      default:
        return null;
    }
  }

  const firstRowFilters = viewFilters.filter((key) => FIRST_ROW_FILTERS.includes(key));
  const secondRowFilters = viewFilters.filter((key) => SECOND_ROW_FILTERS.includes(key));
  const hasFirstRow = Boolean(view.control) || firstRowFilters.length > 0;
  const hasSecondRow = secondRowFilters.length > 0;

  return (
    <div className="page">
      <div className="pageHeader no-print">
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('reports.title')}</h1>
          <p className="mutedText" style={{ margin: 0 }}>{t('reports.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => exportReportCsv(reportName, params)}>{t('reports.exportCsv')}</Button>
          <Button variant="secondary" onClick={() => window.print()}>{t('reports.print')}</Button>
          <Button variant="secondary" onClick={handleShare}>{t('reports.shareToWhatsApp')}</Button>
        </div>
      </div>

      <div className={styles.layout}>
        <nav className={`${styles.nav} no-print`} aria-label={t('reports.title')}>
          {groups.map((group) => (
            <div key={group.key} className={styles.group} role="group" aria-label={t(`reports.groups.${group.key}`)}>
              <div className={styles.groupLabel}>{t(`reports.groups.${group.key}`)}</div>
              <div className={styles.items}>
                {group.reports.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`${styles.navItem} ${name === reportName ? styles.navItemActive : ''}`}
                    aria-current={name === reportName ? 'page' : undefined}
                    onClick={() => selectReport(name)}
                  >
                    {t(`reports.names.${name}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles.content}>
          <header className={styles.reportHeader}>
            <h2 className={styles.reportTitle}>{t(`reports.names.${reportName}`)}</h2>
            <p className="mutedText" style={{ margin: 0 }}>{t(`reports.descriptions.${reportName}`)}</p>
            {summary && <p className={styles.printSummary}>{summary}</p>}
          </header>

          {(hasFirstRow || hasSecondRow) && (
            <div className={`card ${styles.filters} no-print`}>
              <div className={styles.filterRows}>
                {hasFirstRow && (
                  <div className={styles.filterRow}>
                    {view.control === 'range' && (
                      <>
                        <Select label={t('reports.controls.period')} value={range} onChange={(e) => setRange(e.target.value)}>
                          {REPORT_RANGE_PRESETS.map((preset) => <option key={preset} value={preset}>{t(`dashboard.presets.${preset}`)}</option>)}
                          <option value="custom">{t('reports.controls.custom')}</option>
                        </Select>
                        {range === 'custom' && (
                          <>
                            <TextInput label={t('deliveries.filters.from')} type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
                            <TextInput label={t('deliveries.filters.to')} type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
                          </>
                        )}
                      </>
                    )}
                    {view.control === 'days' && (
                      <Select label={t('reports.controls.noDeliveryFor')} value={days} onChange={(e) => setDays(e.target.value)}>
                        {DAY_OPTIONS.map((n) => <option key={n} value={String(n)}>{t('reports.controls.daysOrMore', { count: n })}</option>)}
                      </Select>
                    )}
                    {view.control === 'months' && (
                      <Select label={t('reports.controls.lookBack')} value={months} onChange={(e) => setMonths(e.target.value)}>
                        {MONTH_OPTIONS.map((n) => <option key={n} value={String(n)}>{t('reports.controls.lastMonths', { count: n })}</option>)}
                      </Select>
                    )}
                    {view.control === 'years' && (
                      <>
                        <Select label={t('reports.controls.compare')} value={yearA} onChange={(e) => setYearA(e.target.value)}>
                          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                        </Select>
                        <Select label={t('reports.controls.with')} value={yearB} onChange={(e) => setYearB(e.target.value)}>
                          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                        </Select>
                      </>
                    )}
                    {firstRowFilters.map(renderFilter)}
                  </div>
                )}
                {hasSecondRow && <div className={styles.filterRow}>{secondRowFilters.map(renderFilter)}</div>}
              </div>
              {isFiltered && (
                <Button variant="ghost" className={styles.clearFilters} onClick={clearFilters}>{t('reports.controls.clearFilters')}</Button>
              )}
            </div>
          )}

          {error && <p className="errorText">{error}</p>}

          {loading ? <Spinner /> : (
            <>
              {kpis.length > 0 && (
                <StatGrid>
                  {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} />)}
                </StatGrid>
              )}

              {tableRows.length > 0 && view.charts(rows, ctx)}
              {view.note && <p className="mutedText no-print">{t(view.note)}</p>}

              <div className="card">
                <Table columns={view.columns(rows, ctx)} rows={tableRows} rowKey={view.rowKey} emptyMessage={t('reports.empty')} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
