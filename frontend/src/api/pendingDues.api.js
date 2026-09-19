import api, { downloadCsv } from './client';

// Customer-wise dues (org admin, and office staff in a vehicle_eod org).
export const listPendingDues = (params) => api.get('/pending-dues', params);
// Route-staff's own "My Pending" list.
export const listMyPendingDues = () => api.get('/pending-dues/mine');
export const fetchVehiclePendingSummary = () => api.get('/pending-dues/vehicle-summary');
// Staff-wise pending (route_staff orgs, org admin).
export const fetchStaffPendingSummary = () => api.get('/pending-dues/staff-summary');
// Delivery-wise: every open delivery on its own row, with what's still owed on it.
export const listPendingDeliveries = (params) => api.get('/pending-dues/deliveries', params);
// One customer's dues, itemised (total, what it's made of, each open delivery).
export const getCustomerDues = (customerId) => api.get(`/pending-dues/customers/${customerId}`);

export const exportPendingDuesCsv = (params) => downloadCsv('/pending-dues/export.csv', params, 'pending-dues.csv');
