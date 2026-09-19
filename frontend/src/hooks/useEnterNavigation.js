import { useCallback } from 'react';

// Fields Enter walks through, in DOM order: text/number inputs, the custom
// dropdown triggers, and the checked radio of a radio group (roving tabindex).
const FIELD_SELECTOR = 'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), button[role="combobox"]:not([disabled]), [role="radio"][tabindex="0"]';

// Keyboard-first data entry for a form: Enter moves to the next field,
// Shift+Enter to the previous one, and Enter on the last field calls onLast
// (usually "save"). Focusing a number/text box selects its contents so typing
// replaces the default. Attach `onKeyDown` / `onFocus` to the form's container;
// `containerRef` points at the same element.
//
// Things that own their own Enter are left alone: the custom dropdowns (they
// open / choose, and report the choice through their own onCommit), real
// buttons, and the customer search box, which keeps Enter for "pick the
// highlighted match" — it marks that keypress handled, hence the defaultPrevented
// check. `canLeaveCustomerBox` says whether Enter may move on from that box
// (only once a customer has actually been chosen).
export default function useEnterNavigation({ containerRef, onLast, canLeaveCustomerBox = () => true }) {
  const moveFocus = useCallback((from, direction) => {
    const container = containerRef.current;
    if (!container || !from) return;
    const fields = Array.from(container.querySelectorAll(FIELD_SELECTOR));
    const next = fields[fields.indexOf(from) + direction];
    if (next) next.focus();
    else if (direction > 0 && onLast) onLast();
  }, [containerRef, onLast]);

  const onKeyDown = useCallback((e) => {
    if (e.defaultPrevented) return;
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    const role = target.getAttribute('role');
    if (target.tagName === 'BUTTON' && role !== 'radio' && role !== 'combobox') return;

    e.preventDefault();
    const isCustomerBox = target.tagName === 'INPUT' && role === 'combobox';
    if (isCustomerBox && !canLeaveCustomerBox()) return;
    moveFocus(target, e.shiftKey ? -1 : 1);
  }, [moveFocus, canLeaveCustomerBox]);

  const onFocus = useCallback((e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' && ['text', 'number', 'tel'].includes(target.type)) target.select();
  }, []);

  return { moveFocus, onKeyDown, onFocus };
}
