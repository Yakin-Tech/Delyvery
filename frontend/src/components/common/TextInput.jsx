import styles from './TextInput.module.css';

// `error` (red) is for an actual submit failure. `warn` (amber) is for a
// soft, non-blocking caution — an unusual-but-not-wrong value, or a required
// field that's still empty before the user has tried to submit — so a field
// never gets the same alarming treatment for "double-check this" as it does
// for "this is wrong".
export default function TextInput({ label, error, warn, className = '', id, ...props }) {
  const inputId = id || props.name;
  const stateClass = error ? styles.inputError : warn ? styles.inputWarn : '';
  return (
    <label className={`${styles.wrapper} ${className}`} htmlFor={inputId}>
      {label && <span className={styles.label}>{label}</span>}
      <input id={inputId} className={`${styles.input} ${stateClass}`} {...props} />
      {error ? <span className={styles.error}>{error}</span> : warn ? <span className={styles.warn}>{warn}</span> : null}
    </label>
  );
}
