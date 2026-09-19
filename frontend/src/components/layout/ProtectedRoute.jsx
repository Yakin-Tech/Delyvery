import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { HOME_BY_ROLE } from '../../routes/homeByRole';
import Spinner from '../common/Spinner';

export default function ProtectedRoute({ allowedRoles }) {
  const { t } = useTranslation();
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) return <Spinner label={t('common.loadingApp')} />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
  }

  return <Outlet />;
}
