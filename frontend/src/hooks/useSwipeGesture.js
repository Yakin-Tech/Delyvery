import { useMemo, useRef, useState } from 'react';

const SWIPE_THRESHOLD = 88;

// Plain Pointer Events swipe detector — no gesture library, to keep the
// bundle light for budget Android phones (see the Staff app offline-mode
// plan). Spread the returned `handlers` onto a card; `dragX` and
// `isDragging` are for the card to render its own follow-the-finger offset
// and left/right hint color while dragging.
//
// A drag only "commits" to horizontal once it has moved further sideways
// than vertically, so a vertical scroll over the card is never hijacked as a
// swipe attempt. Position tracking lives in refs (not state) so a move event
// never has to recreate the handlers themselves — only dragX/isDragging,
// which the card actually renders, go through setState.
export default function useSwipeGesture({ onSwipeLeft, onSwipeRight, disabled = false } = {}) {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef(null);
  const axisRef = useRef(null); // 'x' | 'y' | null, once decided
  const dragXRef = useRef(0);
  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight });
  callbacksRef.current = { onSwipeLeft, onSwipeRight };

  const handlers = useMemo(() => {
    if (disabled) return {};

    function reset() {
      startRef.current = null;
      axisRef.current = null;
      dragXRef.current = 0;
      setIsDragging(false);
      setDragX(0);
    }

    function handlePointerDown(e) {
      startRef.current = { x: e.clientX, y: e.clientY };
      axisRef.current = null;
    }

    function handlePointerMove(e) {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      if (!axisRef.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axisRef.current === 'x') setIsDragging(true);
      }

      if (axisRef.current !== 'x') return;
      e.preventDefault();
      dragXRef.current = dx;
      setDragX(dx);
    }

    function handlePointerUp() {
      if (axisRef.current === 'x') {
        if (dragXRef.current >= SWIPE_THRESHOLD) callbacksRef.current.onSwipeRight?.();
        else if (dragXRef.current <= -SWIPE_THRESHOLD) callbacksRef.current.onSwipeLeft?.();
      }
      reset();
    }

    return {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: reset,
      onPointerLeave: (e) => { if (e.buttons === 0) reset(); },
    };
  }, [disabled]);

  return { handlers, dragX, isDragging };
}
