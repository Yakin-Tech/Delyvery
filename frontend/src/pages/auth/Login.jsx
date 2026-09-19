import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import TextInput from '../../components/common/TextInput';
import Button from '../../components/common/Button';
import Logo from '../../components/common/Logo';
import { HOME_BY_ROLE } from '../../routes/homeByRole';
import styles from './Login.module.css';

export default function Login() {
  const { t } = useTranslation();
  const { login, isAuthenticated, user } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(phone.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <Logo className={styles.brandMark} />
        <h1 className={styles.title}>{t('auth.title')}</h1>
        <p className="mutedText">{t('auth.subtitle')}</p>

        <TextInput
          label={t('auth.phoneNumber')}
          name="phone"
          type="tel"
          autoComplete="username"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <TextInput
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="errorText">{error}</p>}

        <Button type="submit" disabled={submitting} className={styles.submitButton}>
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </div>
  );
}
