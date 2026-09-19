import { Children, Fragment, isValidElement, useId } from 'react';
import Dropdown from './Dropdown';
import styles from './TextInput.module.css';

function nodeText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText(node.props.children);
  return String(node);
}

// Reads the <option> children exactly as the old native <select> took them —
// every caller keeps writing <option value="x">Label</option>, including options
// produced by .map() and conditionals — and turns them into Dropdown options.
function collectOptions(children, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      collectOptions(child.props.children, out);
    } else if (child.type === 'option') {
      const label = nodeText(child.props.children);
      out.push({
        value: child.props.value !== undefined ? String(child.props.value) : label,
        label,
        disabled: Boolean(child.props.disabled),
      });
    }
  });
  return out;
}

// Labelled form field around the keyboard-driven Dropdown. Drop-in for the old
// native-select version: the same props (label, error, value, onChange(e) with
// e.target.value, name, disabled, required, style, className) and the same
// <option> children. `onCommit` is the one addition — see Dropdown.
export default function Select({
  label,
  error,
  className = '',
  style,
  id,
  name,
  value,
  onChange,
  onCommit,
  disabled,
  required,
  placeholder,
  children,
  'aria-invalid': ariaInvalid,
}) {
  const uid = useId();
  const labelId = label ? `${uid}-label` : undefined;
  const options = collectOptions(children);

  return (
    <div className={`${styles.wrapper} ${className}`} style={style}>
      {label && <span id={labelId} className={styles.label}>{label}</span>}
      <Dropdown
        id={id || name}
        name={name}
        options={options}
        value={value}
        onChange={onChange ? (next) => onChange({ target: { name, value: next }, currentTarget: { name, value: next } }) : undefined}
        onCommit={onCommit}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        invalid={Boolean(error) || Boolean(ariaInvalid)}
        aria-labelledby={labelId}
      />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
