import api from './client';

export const listCustomers = (params) => api.get('/customers', params);
export const getCustomer = (id) => api.get(`/customers/${id}`);
export const listCustomerOrders = (id, params) => api.get(`/customers/${id}/orders`, params);
export const createCustomer = (data) => api.post('/customers', data);
export const updateCustomer = (id, data) => api.patch(`/customers/${id}`, data);
export const reorderCustomers = (customerIds) => api.patch('/customers/reorder', { customer_ids: customerIds });
export const bulkAssignCustomers = (customerIds, assignedStaffId) => api.patch('/customers/bulk-assign', { customer_ids: customerIds, assigned_staff_id: assignedStaffId || null });
export const bulkAssignCustomersToVehicle = (customerIds, assignedVehicleId) => api.patch('/customers/bulk-assign-vehicle', { customer_ids: customerIds, assigned_vehicle_id: assignedVehicleId || null });
export const bulkSetCustomerStatus = (customerIds, status) => api.patch('/customers/bulk-status', { customer_ids: customerIds, status });
export const topUpWallet = (id, data) => api.post(`/customers/${id}/wallet-topup`, data);
export const getPortalLink = (id) => api.post(`/customers/${id}/portal-link`, {});
