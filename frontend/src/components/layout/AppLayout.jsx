import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import Dropdown from '../common/Dropdown';
import Logo from '../common/Logo';
import FAB from '../common/FAB';
import styles from './AppLayout.module.css';

// Products/Routes/Stock are optional modules the org admin turns on in
// Settings (organization.products_enabled/routes_enabled/stock_enabled) — off
// by default, so a fresh org's nav isn't cluttered with modules it doesn't
// use. moduleFlag is checked against `organization` below; items without one
// (everything else) always show. `visible` is the same idea for the org's
// delivery model (route_staff vs vehicle_eod, set by the Super Admin), where a
// plain boolean flag doesn't fit; `keyFor` swaps an item's label per model.
const isVehicleModel = (org) => org?.delivery_model === 'vehicle_eod';

const NAV_ITEMS = {
  org_admin: [
    { to: '/admin/dashboard', key: 'nav.dashboard' },
    { to: '/admin/deliveries', key: 'nav.deliveries' },
    { to: '/admin/pending-dues', key: 'nav.pendingDues' },
    { to: '/admin/customers', key: 'nav.customers' },
    { to: '/admin/staff', key: 'nav.staff' },
    { to: '/admin/vehicles', key: 'nav.vehicles', visible: isVehicleModel },
    { to: '/admin/products', key: 'nav.products', moduleFlag: 'products_enabled' },
    { to: '/admin/routes', key: 'nav.routes', moduleFlag: 'routes_enabled', visible: (org) => !isVehicleModel(org) },
    { to: '/admin/stock', key: 'nav.stock', moduleFlag: 'stock_enabled' },
    { to: '/admin/reports', key: 'nav.reports' },
    { to: '/admin/settings', key: 'nav.settings' },
  ],
  staff: [
    { to: '/staff/home', key: 'nav.todaysDeliveries', keyFor: (org) => (isVehicleModel(org) ? 'nav.vehicleEod' : 'nav.todaysDeliveries') },
    { to: '/staff/customers', key: 'nav.customers', visible: isVehicleModel },
    { to: '/staff/pending', key: 'nav.myPending', keyFor: (org) => (isVehicleModel(org) ? 'nav.pendingDues' : 'nav.myPending') },
    { to: '/staff/summary', key: 'nav.mySummary' },
    { to: '/staff/settings', key: 'nav.settings' },
  ],
  super_admin: [
    { to: '/super-admin/overview', key: 'nav.overview' },
    { to: '/super-admin/organizations', key: 'nav.organizations' },
    { to: '/super-admin/onboarding-funnel', key: 'nav.onboardingFunnel' },
    { to: '/super-admin/audit-log', key: 'nav.auditLog' },
    { to: '/super-admin/settings', key: 'nav.settings' },
  ],
};

// "Meena Kumar" -> "MK", "Ravi" -> "R": a compact stand-in for a profile photo.
function initialsOf(name) {
  const parts = String(name || '').trim().split(/s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 1)).toUpperCase();
}

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, organization, logout, impersonating, exitImpersonation, changeLanguage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = (NAV_ITEMS[user.role] || []).filter((item) => (
    (!item.moduleFlag || organization?.[item.moduleFlag]) && (!item.visible || item.visible(organization))
  ));

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  function handleExitImpersonation() {
    exitImpersonation();
    navigate('/super-admin/organizations');
  }

  return (
    <div className={styles.shell}>
      {menuOpen && <div className={styles.backdrop} onClick={() => setMenuOpen(false)} />}

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''} no-print`}>
        <div className={styles.brand}>
          <Logo className={styles.brandMark} />
          <div>
            <div className={styles.brandName}>Delyver</div>
            {organization && <div className={styles.orgName}>{organization.name}</div>}
          </div>
        </div>
        <nav className={styles.nav}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
            >
              {t(item.keyFor ? item.keyFor(organization) : item.key)}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.logoutButton} onClick={logout}>
            {t('common.logout')}
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        {impersonating && (
          <div className={styles.impersonationBanner}>
            <span>{t('impersonation.viewingAs', { name: user.name, org: organization?.name })}</span>
            <button type="button" className={styles.exitImpersonationButton} onClick={handleExitImpersonation}>
              {t('impersonation.exit')}
            </button>
          </div>
        )}
        <header className={`${styles.topbar} no-print`}>
          <button
            type="button"
            className={styles.hamburgerButton}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={t('common.menu')}
            aria-expanded={menuOpen}
          >
            <span />
            <span />
            <span />
          </button>

          <div className={styles.userBlock}>
            <span className={styles.avatar} aria-hidden="true">{initialsOf(user.name)}</span>
            <div className={styles.userText}>
              <div className={styles.userName}>{user.name}</div>
              <div className={styles.userRole}>{t(`roles.${user.role}`)}</div>
            </div>
          </div>

          <div className={styles.topbarActions}>
            <Dropdown
              variant="pill"
              className={styles.languageSelect}
              aria-label={t('language.label')}
              options={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
              value={i18n.language}
              onChange={changeLanguage}
            />
          </div>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      {user.role === 'org_admin' && (
        <FAB label={t('deliveries.addDelivery')} onClick={() => navigate('/admin/deliveries?new=1')} />
      )}
    </div>
  );
}
