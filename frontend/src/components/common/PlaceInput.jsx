import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import textStyles from './TextInput.module.css';
import styles from './PlaceInput.module.css';

// A text field for the delivery "place" field with a custom suggestions
// dropdown (not a native <datalist> — that can't carry a per-row remove
// action and renders as a jarringly plain browser-chrome popup that doesn't
// pick up the app's theme). Each suggestion row has a "×" to dismiss it (see
// dismissPlaceSuggestion / place_dismissals in schema.sql) — a dismissed
// place stays out of suggestions until it's actually delivered to again, at
// which point the backend surfaces it again on its own, so there's no
// separate "undo" control here.
export default function PlaceInput({ label, value, onChange, suggestions = [], onDismissSuggestion, style }) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const filtered = suggestions.filter((p) => !value || p.toLowerCase().includes(value.toLowerCase()));

  // Typing, or the list closing, invalidates whatever row was highlighted —
  // re-arm from scratch rather than pointing at a now-stale index.
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [value, open]);

  useEffect(() => {
    if (highlightedIndex >= 0) itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  function selectPlace(place) {
    onChange(place);
    setOpen(false);
  }

  function handleDismiss(e, place) {
    e.stopPropagation();
    onDismissSuggestion(place);
  }

  function handleKeyDown(e) {
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        e.preventDefault();
        selectPlace(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef} style={style}>
      <label className={textStyles.wrapper}>
        {label && <span className={textStyles.label}>{label}</span>}
        <div className={`${styles.inputRow} ${focused ? styles.inputRowFocused : ''}`}>
          <input
            className={styles.input}
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => { setOpen(true); setFocused(true); }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <button
              type="button"
              className={styles.chevronButton}
              onClick={() => setOpen((o) => !o)}
              aria-label={t('deliveries.placeSuggestions.toggle')}
            >
              <svg className={`${styles.chevronIcon} ${open ? styles.chevronIconOpen : ''}`} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </label>

      {open && suggestions.length > 0 && (
        <div className={styles.dropdown} role="listbox" id={listId}>
          {filtered.length === 0 && <div className={styles.emptyRow}>{t('customerPicker.noMatches')}</div>}
          {filtered.map((place, index) => (
            <div
              key={place}
              ref={(el) => { itemRefs.current[index] = el; }}
              role="option"
              aria-selected={index === highlightedIndex}
              className={`${styles.suggestionRow} ${index === highlightedIndex ? styles.suggestionRowActive : ''}`}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <button type="button" className={styles.suggestionButton} onClick={() => selectPlace(place)}>
                {place}
              </button>
              <button
                type="button"
                className={styles.removeButton}
                onClick={(e) => handleDismiss(e, place)}
                aria-label={t('deliveries.placeSuggestions.remove', { place })}
                title={t('deliveries.placeSuggestions.remove', { place })}
              >
                <svg className={styles.removeIcon} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
