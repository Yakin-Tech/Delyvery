import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { changePassword as changePasswordApi } from '../../api/auth.api';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import Button from './Button';
import Dropdown from './Dropdown';
import TextInput from './TextInput';
import styles from './AccountSettingsForm.module.css';

const emptyPasswordForm = { old_password: '', new_password: '' };

// Everything a person can change about their own account, for every role:
// profile name, display language, appearance (light/dark) and password.
// Rendered on the Settings page (staff and super admin) and at the bottom of the
// org admin's Settings page.
export default function AccountSettingsForm() {
  const { t, i18n } = useTranslation();
  const { user, changeTheme, changeLanguage, updateProfile } = useAuth();
  const mode = user?.theme_mode || 'light';

  const [name, setName] = useState(user?.name || '');
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  function applyThemeChange(patch) {
    changeTheme(patch).catch((err) => console.error('Failed to save theme preference:', err));
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileError('');
    setProfileSaved(false);
    setProfileSaving(true);
    try {
      await updateProfile({ name });
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);
    setPasswordSaving(true);
    try {
      await changePasswordApi(passwordForm.old_password, passwordForm.new_password);
      setPasswordForm(emptyPasswordForm);
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  }

  const nameChanged = name.trim() !== (user?.name || '');

  return (
    <div>
      <h2>{t('account.profile')}</h2>
      <form onSubmit={handleProfileSubmit} className={styles.section}>
        <div className="formGrid">
          <TextInput
            label={t('account.name')}
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => { setName(e.target.value); setProfileSaved(false); }}
          />
          <TextInput label={t('account.phone')} value={user?.phone || ''} disabled />
        </div>
        <p className="mutedText" style={{ marginBottom: 0 }}>{t('account.phoneHint')}</p>
        {profileError && <p className="errorText">{profileError}</p>}
        {profileSaved && <p style={{ fontWeight: 600 }}>&#10003; {t('common.saved')}</p>}
        <div className="formActions">
          <Button type="submit" disabled={profileSaving || !nameChanged}>{profileSaving ? t('common.saving') : t('account.saveProfile')}</Button>
        </div>
      </form>

      <h2>{t('account.appearance')}</h2>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t('language.label')}</span>
        <Dropdown
          variant="pill"
          aria-label={t('language.label')}
          options={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
          value={i18n.language}
          onChange={changeLanguage}
        />
      </div>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t('theme.modeLabel')}</span>
        <div className={styles.modeRow}>
          <button
            type="button"
            className={`${styles.modeButton} ${mode === 'light' ? styles.modeButtonActive : ''}`}
            onClick={() => applyThemeChange({ mode: 'light' })}
          >
            {t('theme.light')}
          </button>
          <button
            type="button"
            className={`${styles.modeButton} ${mode === 'dark' ? styles.modeButtonActive : ''}`}
            onClick={() => applyThemeChange({ mode: 'dark' })}
          >
            {t('theme.dark')}
          </button>
        </div>
      </div>

      <h2>{t('account.changePassword')}</h2>
      <form onSubmit={handlePasswordSubmit}>
        <div className="formGrid">
          <TextInput
            label={t('account.oldPassword')}
            type="password" required
            value={passwordForm.old_password}
            onChange={(e) => setPasswordForm({ ...passwordForm, old_password: e.target.value })}
          />
          <TextInput
            label={t('account.newPassword')}
            type="password" required minLength={6}
            value={passwordForm.new_password}
            onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
          />
        </div>
        {passwordError && <p className="errorText">{passwordError}</p>}
        {passwordSaved && <p style={{ fontWeight: 600 }}>&#10003; {t('account.passwordChanged')}</p>}
        <div className="formActions">
          <Button type="submit" disabled={passwordSaving}>{passwordSaving ? t('common.saving') : t('account.updatePassword')}</Button>
        </div>
      </form>
    </div>
  );
}
