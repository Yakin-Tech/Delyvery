import api, { downloadCsv } from './client';

export const REPORT_NAMES = [
  'sales-overview',
  'collections',
  'pending-aging',
  'collection-efficiency',
  'product-sales',
  'top-customers',
  'year-over-year',
  'customer-inactivity',
  'new-customer-acquisition',
  'zone-performance',
  'vehicle-performance',
  'staff-productivity',
];

// Reports that only make sense under one delivery model — staff/zone ones
// need staff who deliver live along a route, the vehicle one needs vehicles.
const ROUTE_STAFF_ONLY_REPORTS = ['staff-productivity', 'zone-performance'];
const VEHICLE_EOD_ONLY_REPORTS = ['vehicle-performance'];

export function reportNamesFor(organization) {
  const hidden = organization?.delivery_model === 'vehicle_eod' ? ROUTE_STAFF_ONLY_REPORTS : VEHICLE_EOD_ONLY_REPORTS;
  return REPORT_NAMES.filter((name) => !hidden.includes(name));
}

export const getReport = (name, params) => api.get(`/reports/${name}`, params);
export const exportReportCsv = (name, params) => downloadCsv(`/reports/${name}/export.csv`, params, `${name}.csv`);
