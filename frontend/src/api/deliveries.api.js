import api from './client';

export const listDeliveries = (params) => api.get('/deliveries', params);
export const createDelivery = (data) => api.post('/deliveries', data);
export const updateDelivery = (id, data) => api.patch(`/deliveries/${id}`, data);
export const deleteDelivery = (id) => api.delete(`/deliveries/${id}`);
export const fetchTodayBoard = () => api.get('/deliveries/today-board');
export const fetchMySummary = (params) => api.get('/deliveries/my-summary', params);
export const fetchRecentPlaces = (customerId) => api.get('/deliveries/places', { customer_id: customerId });
export const dismissPlaceSuggestion = (customerId, place) => api.post('/deliveries/places/dismiss', { customer_id: customerId, place });
export const skipDelivery = (data) => api.post('/deliveries/skip', data);
export const syncDeliveryBatch = (items) => api.post('/deliveries/sync-batch', { items });
export const submitVehicleEodBatch = (data) => api.post('/deliveries/vehicle-eod-batch', data);
