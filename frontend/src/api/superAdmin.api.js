import api from './client';

export const fetchPlatformStats = () => api.get('/super-admin/stats');
export const fetchPlatformTimeseries = () => api.get('/super-admin/stats/timeseries');
export const listOrganizations = (params) => api.get('/super-admin/organizations', params);
export const createOrganization = (data) => api.post('/super-admin/organizations', data);
export const getOrganization = (id) => api.get(`/super-admin/organizations/${id}`);
export const updateOrganization = (id, data) => api.patch(`/super-admin/organizations/${id}`, data);
export const createOrgAdmin = (orgId, data) => api.post(`/super-admin/organizations/${orgId}/admins`, data);
export const updateOrgAdminStatus = (orgId, userId, status) => api.patch(`/super-admin/organizations/${orgId}/admins/${userId}`, { status });
export const resetOrgAdminPassword = (orgId, userId, password) => api.post(`/super-admin/organizations/${orgId}/admins/${userId}/reset-password`, { password });
export const impersonateOrganization = (orgId, asUserId) => api.post(`/super-admin/organizations/${orgId}/impersonate`, asUserId ? { as_user_id: asUserId } : {});
export const listAuditLog = (params) => api.get('/super-admin/audit-log', params);
export const fetchActivityStats = () => api.get('/super-admin/stats/activity');
export const fetchErrorStats = () => api.get('/super-admin/stats/errors');
export const fetchOnboardingFunnel = () => api.get('/super-admin/stats/onboarding-funnel');
export const fetchTopOrgs = () => api.get('/super-admin/stats/top-orgs');
