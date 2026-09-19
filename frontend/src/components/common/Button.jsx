import styles from './Button.module.css';

const VARIANT_CLASS = {
  primary: styles.primary,
  secondary: styles.secondary,
  danger: styles.danger,
  ghost: styles.ghost,
};

export default function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  const variantClass = VARIANT_CLASS[variant] || styles.primary;
  return <button type={type} className={`${styles.button} ${variantClass} ${className}`} {...props} />;
}
