import api from './client';

export const getDashboard = (params) => api.get('/dashboard', params);
