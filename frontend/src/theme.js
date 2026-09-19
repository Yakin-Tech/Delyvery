const STORAGE_KEY = 'delyver.theme';

export const MODES = ['light', 'dark'];
export const DEFAULT_THEME = { mode: 'light' };

export function readStoredTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    return { mode: MODES.includes(parsed.mode) ? parsed.mode : DEFAULT_THEME.mode };
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStoredTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Storage can be unavailable (private browsing, quota); theme still
    // applies for this session via the DOM attribute below.
  }
}

// Applies the theme to <html> — every CSS variable override in variables.css
// is keyed off this attribute — and remembers it locally so it survives a
// reload even before the user's own preference has loaded from the server.
export function applyTheme(theme) {
  const next = { mode: MODES.includes(theme?.mode) ? theme.mode : DEFAULT_THEME.mode };
  document.documentElement.setAttribute('data-theme', next.mode);
  writeStoredTheme(next);
  return next;
}
