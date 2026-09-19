import { useRef } from 'react';
import styles from './Tabs.module.css';

// A row of pill tabs following the WAI-ARIA tabs pattern: one tab stop, ← →
// (and Home / End) move between tabs and select them.
// tabs: [{ value, label }]
export default function Tabs({ tabs, value, onChange, label }) {
  const buttonRefs = useRef([]);

  function handleKeyDown(e) {
    const current = tabs.findIndex((tab) => tab.value === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    buttonRefs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={styles.tabs} onKeyDown={handleKeyDown}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          ref={(el) => { buttonRefs.current[index] = el; }}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          className={`${styles.tab} ${tab.value === value ? styles.active : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
