import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listCustomers } from '../../api/customers.api';
import TextInput from './TextInput';
import Badge from './Badge';
import styles from './CustomerPicker.module.css';

const PHONE_LIKE = /^\d[\d\s-]*$/;

// Search-as-you-type existing customers by name/phone, with an always-present
// "add as new customer" fallback — so logging a delivery never requires the
// person to already exist in the system. `value` is either null, an existing
// customer selection, or a new-customer draft; `onChange` receives the same shape.
// Pass allowNew={false} for a pure existing-customer search (e.g. recording a
// payment, where there's nothing to pay if the customer doesn't exist yet) —
// the "add as new" row is hidden and a no-matches message shows instead.
// Pass highlightFirst for fast keyboard entry: the first match is highlighted as
// soon as results arrive, so typing a few letters and pressing Enter picks it
// (Enter is ignored while a search is still in flight, so it can never pick a
// stale result from an earlier, shorter query).
export default function CustomerPicker({ label, value, onChange, allowNew = true, highlightFirst = false }) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);
  const wrapperRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!query.trim()) {
      clearTimeout(debounceRef.current);
      requestIdRef.current += 1; // invalidate any in-flight search
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const requestId = (requestIdRef.current += 1);
    clearTimeout(debounceRef.current);
    // 150ms is short enough to feel instant while still collapsing a fast
    // typist's keystrokes into one request instead of firing on every
    // character. requestId guards against an earlier, slower request
    // resolving after a newer one and clobbering its (more current) results.
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await listCustomers({ search: query, page_size: 8 });
        if (requestId === requestIdRef.current) setSuggestions(result.data);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // The "+ Add as new customer" row rides along as one extra, always-last
  // entry in the same up/down cycle as the customer suggestions, rather than
  // being a separate control outside arrow-key reach.
  const showAddNew = allowNew && query.trim().length > 0;
  const itemCount = suggestions.length + (showAddNew ? 1 : 0);

  useEffect(() => {
    setHighlightedIndex(highlightFirst && itemCount > 0 ? 0 : -1);
  }, [query, open, highlightFirst, itemCount]);

  useEffect(() => {
    if (highlightedIndex >= 0) itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  function selectExisting(customer) {
    onChange({ mode: 'existing', customer_id: customer.id, name: customer.name, customer });
    setOpen(false);
    setQuery('');
  }

  function startNew() {
    const looksLikePhone = PHONE_LIKE.test(query.trim());
    onChange({
      mode: 'new',
      name: looksLikePhone ? '' : query.trim(),
      phone: looksLikePhone ? query.trim() : '',
    });
    setOpen(false);
    setQuery('');
  }

  function activateIndex(index) {
    if (index < suggestions.length) selectExisting(suggestions[index]);
    else if (showAddNew) startNew();
  }

  function handleKeyDown(e) {
    // Esc closes the results list first; only when no list is showing does it reach
    // whatever is around this field (e.g. a dialog it should close).
    if (e.key === 'Escape' && open && query.trim()) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!open || itemCount === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? itemCount - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (highlightFirst && searching) {
        e.preventDefault();
        return;
      }
      if (highlightedIndex >= 0 && highlightedIndex < itemCount) {
        e.preventDefault();
        activateIndex(highlightedIndex);
      }
    }
  }

  function clearSelection() {
    onChange(null);
    setQuery('');
  }

  // Once a customer is chosen their name stays in the same text box (rather than
  // swapping to a locked row with a button): focus never moves, Shift+Tab /
  // Shift+Enter come straight back to it from the next field, and typing
  // anything replaces the choice with a fresh search.
  const isExisting = value?.mode === 'existing';

  function handleInputChange(e) {
    if (isExisting) onChange(null);
    setQuery(e.target.value);
    setOpen(true);
  }

  function handleInputFocus(e) {
    setOpen(true);
    if (isExisting) e.target.select();
  }

  function changeCustomer() {
    clearSelection();
    wrapperRef.current?.querySelector('input')?.focus();
  }

  if (value?.mode === 'new') {
    return (
      <div className={styles.newCustomerBlock}>
        <div className={styles.newCustomerHeader}>
          <Badge tone="neutral">{t('customerPicker.newCustomer')}</Badge>
          <button type="button" className={styles.changeButton} onClick={clearSelection}>{t('customerPicker.change')}</button>
        </div>
        <div className="formGrid">
          <TextInput
            label={t('customerPicker.name')}
            required
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          <TextInput
            label={t('customerPicker.phone')}
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      {(label || isExisting) && (
        <div className={styles.labelRow}>
          {label && <span className={styles.label}>{label}</span>}
          {isExisting && (
            <button type="button" tabIndex={-1} className={styles.changeButton} onClick={changeCustomer}>{t('customerPicker.change')}</button>
          )}
        </div>
      )}
      <TextInput
        aria-label={label || t('customerPicker.searchPlaceholder')}
        placeholder={t('customerPicker.searchPlaceholder')}
        value={isExisting ? value.name : query}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && query.trim() && (
        <div className={styles.dropdown} role="listbox" id={listId}>
          {suggestions.length === 0 && searching && <div className={styles.emptyRow}>{t('customerPicker.searching')}</div>}
          {suggestions.length === 0 && !searching && !showAddNew && <div className={styles.emptyRow}>{t('customerPicker.noMatches')}</div>}
          {suggestions.map((c, index) => (
            <button
              key={c.id}
              ref={(el) => { itemRefs.current[index] = el; }}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={`${styles.suggestionRow} ${index === highlightedIndex ? styles.suggestionRowActive : ''}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectExisting(c)}
            >
              <span className={styles.suggestionName}>{c.name}</span>
              <span className={styles.suggestionMeta}>{c.phone || ''}</span>
            </button>
          ))}
          {showAddNew && (
            <button
              ref={(el) => { itemRefs.current[suggestions.length] = el; }}
              type="button"
              role="option"
              aria-selected={suggestions.length === highlightedIndex}
              className={`${styles.addNewRow} ${suggestions.length === highlightedIndex ? styles.addNewRowActive : ''}`}
              onMouseEnter={() => setHighlightedIndex(suggestions.length)}
              onClick={startNew}
            >
              <span className={styles.addNewRowInner}>{t('customerPicker.addNew', { query: query.trim() })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
