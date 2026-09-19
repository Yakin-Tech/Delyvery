import api from './client';

export const getOwnOrganization = () => api.get('/organization');
export const updateOwnOrganization = (data) => api.patch('/organization', data);
export const updateOnboarding = (data) => api.patch('/organization/onboarding', data);
