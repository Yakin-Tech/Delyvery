import api from './client';

export const listCreditNotesForCustomer = (customerId) => api.get(`/credit-notes/customer/${customerId}`);
export const createCreditNote = (data) => api.post('/credit-notes', data);
export const voidCreditNote = (id) => api.post(`/credit-notes/${id}/void`);
