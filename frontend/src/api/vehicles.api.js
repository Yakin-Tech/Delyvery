import api from './client';

export const listVehicles = (params) => api.get('/vehicles', params);
export const createVehicle = (data) => api.post('/vehicles', data);
export const updateVehicle = (id, data) => api.patch(`/vehicles/${id}`, data);
