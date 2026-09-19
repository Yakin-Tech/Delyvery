import { FiEdit2, FiTrash2, FiEye, FiX } from 'react-icons/fi';
import styles from './IconButton.module.css';

const ICONS = { edit: FiEdit2, delete: FiTrash2, view: FiEye, remove: FiX };

// A compact icon-only action for table rows (pen = edit, dustbin = delete...).
// The icon carries no words, so `label` is required: it becomes the accessible
// name and the hover tooltip.
export default function IconButton({ icon, label, disabled = false, onClick, type = 'button', ...rest }) {
  const Icon = ICONS[icon];
  return (
    <button
      type={type}
      className={`${styles.button} ${icon === 'delete' || icon === 'remove' ? styles.danger : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      <Icon aria-hidden="true" focusable="false" />
    </button>
  );
}

// Lays a row's icon buttons out side by side.
export function RowActions({ children }) {
  return <div className={styles.actions}>{children}</div>;
}
