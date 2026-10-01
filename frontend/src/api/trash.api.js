import api from './client';

export const listTrash = (params) => api.get('/trash', params);
export const restoreFromTrash = (type, id) => api.post(`/trash/${type}/${id}/restore`, {});
export const permanentlyDelete = (type, id) => api.delete(`/trash/${type}/${id}`);
export const anonymizeInTrash = (type, id) => api.post(`/trash/${type}/${id}/anonymize`, {});
export const forceDeleteFromTrash = (type, id) => api.post(`/trash/${type}/${id}/force-delete`, {});
