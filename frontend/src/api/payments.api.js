import api from './client';

export const createPayment = (data) => api.post('/payments', data);
