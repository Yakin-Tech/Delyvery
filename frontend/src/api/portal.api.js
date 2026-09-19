import api from './client';

// Public endpoint — no auth token is ever attached here (see
// backend/src/routes/portal.routes.js), which is fine: api.get() simply
// omits the Authorization header when nothing has called setAuthToken(),
// exactly the state a visitor lands in on this page.
export const getPortalData = (token) => api.get(`/portal/${token}`);
