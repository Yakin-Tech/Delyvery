import i18next from '../i18n';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// The server's messages are English. Known ones are looked up in the current
// language (apiErrors.<slug of the message>); anything else is shown as sent.
function translateServerMessage(message) {
  if (!message) return message;
  const slug = String(message).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const key = `apiErrors.${slug}`;
  return i18next.exists(key) ? i18next.t(key) : message;
}

let authToken = null;

// Set once by AuthContext on login/logout/app-load so every api/* call can attach
// the current JWT without each call site having to know about auth state.
export function setAuthToken(token) {
  authToken = token;
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(i18next.t('errors.network'));
  }

  if (response.status === 204) return null;

  const isCsv = response.headers.get('content-type')?.includes('text/csv');
  const payload = isCsv ? await response.text() : await response.json().catch(() => null);

  if (!response.ok) {
    const message = translateServerMessage(payload && payload.error) || i18next.t('errors.requestFailed', { status: response.status });
    const error = new Error(message);
    error.status = response.status;
    error.details = payload && payload.details;
    throw error;
  }

  return payload;
}

const api = {
  get: (path, params) => request(path, { method: 'GET', params }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

// A CSV export endpoint returns a file attachment (not JSON), and needs the
// auth token attached the same way every other call does — a plain <a href>
// can't carry an Authorization header, so this fetches the blob directly and
// triggers the save via a throwaway link, same pattern originally built for
// pendingDues.api.js's exportPendingDuesCsv, shared here for the Part 3
// reports (each has its own CSV export button).
export async function downloadCsv(path, params, filename) {
  const url = new URL(`${API_BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response;
  try {
    response = await fetch(url.toString(), { headers });
  } catch {
    throw new Error(i18next.t('errors.network'));
  }
  if (!response.ok) throw new Error(i18next.t('errors.exportFailed'));
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(link.href);
}

export default api;
