import api from './client';

export const listProducts = (params) => api.get('/products', params);
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.patch(`/products/${id}`, data);
export const getPriceHistory = (id) => api.get(`/products/${id}/price-history`);
export const applyPriceRetroactively = (id, data) => api.post(`/products/${id}/apply-price-retroactively`, data);
