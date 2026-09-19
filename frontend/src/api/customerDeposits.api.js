import api from './client';

export const listDepositsForCustomer = (customerId) => api.get(`/customer-deposits/customer/${customerId}`);
export const createDeposit = (data) => api.post('/customer-deposits', data);
export const recordDepositReturn = (id, amount) => api.post(`/customer-deposits/${id}/return`, { amount });
