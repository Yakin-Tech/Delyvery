import api from './client';

export const listStaff = () => api.get('/staff');
export const createStaff = (data) => api.post('/staff', data);
export const updateStaff = (id, data) => api.patch(`/staff/${id}`, data);
export const resetStaffPassword = (id, password) => api.post(`/staff/${id}/reset-password`, { password });
