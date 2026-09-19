import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styles from './Dropdown.module.css';

const TYPEAHEAD_RESET_MS = 700;
const LIST_MAX_HEIGHT = 288;
const OPTION_ESTIMATE_HEIGHT = 38;

const isPrintableKey = (e) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

// Keyboard-first replacement for the native <select>, following the WAI-ARIA
// "select-only combobox" pattern. With the trigger focused:
//   Enter / Space / ↑ / ↓   open the list        letters   open it on the best match
//   ↑ ↓ Home End PgUp PgDn   move                Enter     choose + close (fires onCommit)
//   Esc                      close, no change    Tab       choose the highlighted one and move on
// The list is portalled to <body> and positioned with fixed coordinates, so it
// is never clipped by a modal, a scrolling card or an overflow:hidden parent,
// and it flips upward near the bottom of the screen. Focus never leaves the
// trigger (options are tracked with aria-activedescendant), so the user's place
// in the form is never lost.
//
// options: [{ value: string, label: string, disabled?: boolean }]
// onChange(value) fires whenever the value changes; onCommit(source) fires only
// when the person actively finishes a choice (source is 'keyboard' or 'mouse'),
// which lets a form move focus on to its next field.
export default function Dropdown({
  options,
  value,
  onChange,
  onCommit,
  name,
  id,
  disabled = false,
  required = false,
  placeholder = '',
  variant = 'field',
  className = '',
  invalid = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}) {
  const { t } = useTranslation();
  const reactId = useId();
  const listId = `${reactId}-list`;
  const optionId = (index) => `${reactId}-option-${index}`;

  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typeahead = useRef({ text: '', timer: null });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState(null);

  const currentValue = value === null || value === undefined ? '' : String(value);
  const selectedIndex = options.findIndex((o) => o.value === currentValue);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const isEnabled = (index) => index >= 0 && index < options.length && !options[index].disabled;
  const firstEnabled = (from, step) => {
    for (let i = from; i >= 0 && i < options.length; i += step) if (isEnabled(i)) return i;
    return -1;
  };

  function openList(index) {
    if (disabled || options.length === 0) return;
    setActive(index !== undefined && index >= 0 ? index : (selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1)));
    setOpen(true);
  }

  function commit(index, source) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== currentValue && onChange) onChange(option.value);
    setOpen(false);
    if (source && onCommit) onCommit(source);
  }

  function moveActive(step, jumpTo) {
    setActive((current) => {
      const target = jumpTo !== undefined ? jumpTo : current + step;
      const clamped = Math.max(0, Math.min(options.length - 1, target));
      // Land on the nearest enabled option in the direction of travel.
      const direction = step < 0 || (jumpTo !== undefined && jumpTo < current) ? -1 : 1;
      const found = firstEnabled(clamped, direction);
      return found >= 0 ? found : current;
    });
  }

  // Type-ahead: letters typed in quick succession build a prefix; a single
  // repeated letter cycles through the options starting with it.
  function findByTyping(char, from) {
    const state = typeahead.current;
    clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = setTimeout(() => { state.text = ''; }, TYPEAHEAD_RESET_MS);
    const start = state.text.length === 1 ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < options.length; k += 1) {
      const index = (start + k) % options.length;
      if (isEnabled(index) && options[index].label.toLowerCase().startsWith(state.text)) return index;
    }
    return -1;
  }

  function handleKeyDown(e) {
    if (disabled) return;
    const { key } = e;
    // Shift/Ctrl/Alt + Enter belong to the surrounding form (move back, submit…).
    if (key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)) return;

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        openList();
      } else if (key === 'Home') {
        e.preventDefault();
        openList(firstEnabled(0, 1));
      } else if (key === 'End') {
        e.preventDefault();
        openList(firstEnabled(options.length - 1, -1));
      } else if (isPrintableKey(e)) {
        e.preventDefault();
        openList(findByTyping(key, selectedIndex));
      }
      return;
    }

    switch (key) {
      case 'ArrowDown': e.preventDefault(); moveActive(1); break;
      case 'ArrowUp': e.preventDefault(); moveActive(-1); break;
      case 'PageDown': e.preventDefault(); moveActive(1, active + 10); break;
      case 'PageUp': e.preventDefault(); moveActive(-1, active - 10); break;
      case 'Home': e.preventDefault(); setActive(firstEnabled(0, 1)); break;
      case 'End': e.preventDefault(); setActive(firstEnabled(options.length - 1, -1)); break;
      case 'Enter':
        e.preventDefault();
        commit(active, 'keyboard');
        break;
      case ' ':
        e.preventDefault();
        if (typeahead.current.text) {
          const match = findByTyping(' ', active);
          if (match >= 0) setActive(match);
        } else {
          commit(active, 'keyboard');
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        // Same as the native control: leaving with the list open keeps the highlighted choice.
        if (active >= 0) commit(active);
        else setOpen(false);
        break;
      default:
        if (isPrintableKey(e)) {
          e.preventDefault();
          const match = findByTyping(key, active);
          if (match >= 0) setActive(match);
        }
    }
  }

  function handleTriggerClick() {
    if (open) setOpen(false);
    else openList();
    // Some browsers (Safari) don't focus a button on click, and the keyboard
    // handling above only works while the trigger has focus.
    triggerRef.current?.focus();
  }

  // Close on a click anywhere outside the trigger and the list.
  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (triggerRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => () => clearTimeout(typeahead.current.timer), []);

  // Place the list under (or, near the bottom of the screen, over) the trigger.
  // Runs before paint, and again on resize/scroll so it follows the trigger.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    function place() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const list = listRef.current;
      const listWidth = list ? list.offsetWidth : rect.width;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const wanted = Math.min(options.length * OPTION_ESTIMATE_HEIGHT + 10, LIST_MAX_HEIGHT);
      const openUp = spaceBelow < wanted && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(LIST_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - listWidth - 8)),
        minWidth: rect.width,
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);

  // Keep the highlighted option visible as the arrow keys move it.
  useEffect(() => {
    if (!open || active < 0) return;
    const list = listRef.current;
    const element = list?.querySelector(`[data-index="${active}"]`);
    if (!element) return;
    const top = element.offsetTop;
    const bottom = top + element.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(top - 4, 0);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }, [open, active, position]);

  const triggerClasses = [
    styles.trigger,
    variant === 'pill' ? styles.pill : styles.field,
    invalid ? styles.invalid : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={`${styles.root} ${variant === 'pill' ? styles.rootPill : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        className={triggerClasses}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className={selected ? styles.value : styles.placeholder}>{selected ? selected.label : (placeholder || ' ')}</span>
        <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* A custom control can't take native "required" validation, so an invisible
          input stands in for it: the browser's own "fill out this field" bubble
          appears on the trigger and blocks the submit, and focus is handed back. */}
      {required && (
        <input
          className={styles.proxy}
          tabIndex={-1}
          aria-hidden="true"
          required
          value={currentValue}
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
        />
      )}

      {open && createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={`${styles.list} ${variant === 'pill' ? styles.listPill : ''}`}
          style={position || { visibility: 'hidden', top: 0, left: 0 }}
          // Keep the trigger focused while the list is used with the mouse, and
          // stop clicks from reaching a modal's backdrop through the React tree.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          {options.length === 0 && <div className={styles.empty}>{t('dropdown.noOptions')}</div>}
          {options.map((option, index) => (
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              data-index={index}
              aria-selected={index === selectedIndex}
              aria-disabled={option.disabled || undefined}
              className={[
                styles.option,
                index === active ? styles.optionActive : '',
                index === selectedIndex ? styles.optionSelected : '',
                option.disabled ? styles.optionDisabled : '',
              ].filter(Boolean).join(' ')}
              onMouseMove={() => { if (!option.disabled && active !== index) setActive(index); }}
              onClick={() => commit(index, 'mouse')}
            >
              <span>{option.label}</span>
              {index === selectedIndex && (
                <svg className={styles.check} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="m2.5 6.5 2.5 2.5 4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
