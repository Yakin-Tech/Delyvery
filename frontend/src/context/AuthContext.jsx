import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { login as loginApi, fetchMe, updateMe } from '../api/auth.api';
import { setAuthToken } from '../api/client';
import i18next from '../i18n';
import { applyTheme } from '../theme';

const AuthContext = createContext(null);
const STORAGE_KEY = 'delyver.auth';
const IMPERSONATION_ORIGIN_KEY = 'delyver.impersonation.origin';

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function syncLanguage(user) {
  const lang = user?.preferred_language || 'en';
  if (i18next.language !== lang) i18next.changeLanguage(lang);
}

function syncTheme(user) {
  if (!user) return;
  applyTheme({ mode: user.theme_mode });
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(() => readJson(STORAGE_KEY));
  const [impersonationOrigin, setImpersonationOrigin] = useState(() => readJson(IMPERSONATION_ORIGIN_KEY));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = readJson(STORAGE_KEY);
    if (stored?.token) {
      syncLanguage(stored.user);
      syncTheme(stored.user);
      setAuthToken(stored.token);
      fetchMe()
        .then(({ user, organization, impersonated_by }) => {
          const next = { token: stored.token, user, organization, impersonatedBy: impersonated_by };
          setState(next);
          syncLanguage(user);
          syncTheme(user);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        })
        .catch(() => {
          setAuthToken(null);
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
          setState(null);
          setImpersonationOrigin(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (phone, password) => {
    const { token, user, organization } = await loginApi(phone, password);
    setAuthToken(token);
    const next = { token, user, organization, impersonatedBy: null };
    setState(next);
    syncLanguage(user);
    syncTheme(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
    setState(null);
    setImpersonationOrigin(null);
  }, []);

  // Called after POST /super-admin/organizations/:id/impersonate. Stashes the
  // Super Admin's own session so exitImpersonation can restore it without a
  // fresh login, then swaps the active session to the impersonated org_admin.
  const startImpersonation = useCallback(({ token, user, organization, impersonated_by }) => {
    if (state?.token) {
      localStorage.setItem(IMPERSONATION_ORIGIN_KEY, JSON.stringify(state));
      setImpersonationOrigin(state);
    }
    setAuthToken(token);
    const next = { token, user, organization, impersonatedBy: impersonated_by };
    setState(next);
    syncLanguage(user);
    syncTheme(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, [state]);

  const exitImpersonation = useCallback(() => {
    const origin = readJson(IMPERSONATION_ORIGIN_KEY);
    if (!origin?.token) return;
    setAuthToken(origin.token);
    setState(origin);
    syncLanguage(origin.user);
    syncTheme(origin.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(origin));
    localStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
    setImpersonationOrigin(null);
  }, []);

  // Persists the chosen display language on the user's own account (via
  // PATCH /auth/me) so it sticks everywhere, on any device, until changed
  // again — not just in this browser's localStorage.
  const changeLanguage = useCallback(async (langCode) => {
    const { user: updatedUser } = await updateMe({ preferred_language: langCode });
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user: { ...prev.user, preferred_language: updatedUser.preferred_language } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    i18next.changeLanguage(langCode);
  }, []);

  // Same pattern as changeLanguage: persists the light/dark choice to the
  // user's account (sticks across devices) and applies it immediately.
  const changeTheme = useCallback(async ({ mode }) => {
    const { user: updatedUser } = await updateMe({ theme_mode: mode });
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user: { ...prev.user, theme_mode: updatedUser.theme_mode } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    applyTheme({ mode: updatedUser.theme_mode });
  }, []);

  // Renames the signed-in user on their own account (PATCH /auth/me), and in the
  // cached session so the topbar shows the new name straight away.
  const updateProfile = useCallback(async ({ name }) => {
    const { user: updatedUser } = await updateMe({ name });
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user: { ...prev.user, name: updatedUser.name } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Lets a page that just saved org settings (e.g. SettingsPage) push the
  // updated organization into shared auth state, so every other page reading
  // useAuth().organization sees the change immediately instead of only after
  // a re-login/refresh (req.organization on the backend is always fresh —
  // this just keeps the frontend's cached copy from going stale).
  const updateOrganization = useCallback((organization) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, organization };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    token: state?.token || null,
    user: state?.user || null,
    organization: state?.organization || null,
    isAuthenticated: !!state?.token,
    impersonating: !!impersonationOrigin,
    loading,
    login,
    logout,
    startImpersonation,
    exitImpersonation,
    changeLanguage,
    changeTheme,
    updateProfile,
    updateOrganization,
  }), [state, impersonationOrigin, loading, login, logout, startImpersonation, exitImpersonation, changeLanguage, changeTheme, updateProfile, updateOrganization]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
