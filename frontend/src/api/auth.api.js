import api from './client';

export const login = (phone, password) => api.post('/auth/login', { phone, password });
export const fetchMe = () => api.get('/auth/me');
export const updateMe = (data) => api.patch('/auth/me', data);
export const changePassword = (oldPassword, newPassword) => api.post('/auth/me/password', { old_password: oldPassword, new_password: newPassword });
