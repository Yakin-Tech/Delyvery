// Best-effort navigator.vibrate wrapper. Silently does nothing on browsers
// without the API (notably iOS Safari) or when the call itself throws (some
// browsers reject vibrate() outside a user gesture) — haptics are a nice-to-
// have confirmation, never something a flow should depend on.
function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // No-op — see comment above.
  }
}

export const vibrateSuccess = () => vibrate(40);
export const vibrateWarn = () => vibrate([30, 60, 30]);
