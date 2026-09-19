import { useTranslation } from 'react-i18next';
import AccountSettingsForm from '../../components/common/AccountSettingsForm';

// The Settings page for staff and super admins: their own name, language,
// appearance and password. (The org admin has the same form at the bottom of
// their organization Settings page.)
export default function AccountPage() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('nav.settings')}</h1>
      </div>
      <div className="card">
        <AccountSettingsForm />
      </div>
    </div>
  );
}
