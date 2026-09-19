import { useCallback, useRef, useState } from 'react';

// Delays an action (e.g. a destructive API call) by `delayMs`, giving the
// caller a window to cancel it via an "Undo" affordance instead of it firing
// immediately and irreversibly. Only one action can be pending at a time —
// that's all any current call site needs.
export default function useDelayedAction(delayMs = 6000) {
  const [pending, setPending] = useState(null); // { id } | null
  const timerRef = useRef(null);
  const actionRef = useRef(null);
  const undoRef = useRef(null);

  const schedule = useCallback((id, action, onUndo) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    actionRef.current = action;
    undoRef.current = onUndo;
    setPending({ id });
    timerRef.current = setTimeout(() => {
      const run = actionRef.current;
      actionRef.current = null;
      undoRef.current = null;
      timerRef.current = null;
      setPending(null);
      run?.();
    }, delayMs);
  }, [delayMs]);

  const undo = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    actionRef.current = null;
    const onUndo = undoRef.current;
    undoRef.current = null;
    setPending(null);
    onUndo?.();
  }, []);

  return { pending, schedule, undo };
}
