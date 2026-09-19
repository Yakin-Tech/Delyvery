import api from './client';

export const getStockSummary = () => api.get('/stock');
export const listStockForProduct = (productId) => api.get(`/stock/product/${productId}`);
export const createStockMovement = (data) => api.post('/stock', data);
