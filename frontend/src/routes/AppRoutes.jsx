import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HOME_BY_ROLE } from './homeByRole';
import ProtectedRoute from '../components/layout/ProtectedRoute';
import AppLayout from '../components/layout/AppLayout';
import Login from '../pages/auth/Login';
import DashboardPage from '../pages/orgAdmin/DashboardPage';
import OnboardingWizardPage from '../pages/orgAdmin/OnboardingWizardPage';
import StaffPage from '../pages/orgAdmin/StaffPage';
import VehiclesPage from '../pages/orgAdmin/VehiclesPage';
import CustomersPage from '../pages/orgAdmin/CustomersPage';
import CustomerDetailPage from '../pages/orgAdmin/CustomerDetailPage';
import DeliveriesPage from '../pages/orgAdmin/DeliveriesPage';
import PendingDuesPage from '../pages/orgAdmin/PendingDuesPage';
import SettingsPage from '../pages/orgAdmin/SettingsPage';
import ProductsPage from '../pages/orgAdmin/ProductsPage';
import StockPage from '../pages/orgAdmin/StockPage';
import RouteReorderPage from '../pages/orgAdmin/RouteReorderPage';
import ReportsPage from '../pages/orgAdmin/ReportsPage';
import PortalPage from '../pages/portal/PortalPage';
import DailyRunSheetPage from '../pages/staff/DailyRunSheetPage';
import VehicleEodEntryPage from '../pages/staff/VehicleEodEntryPage';
import MyPendingPage from '../pages/staff/MyPendingPage';
import StaffCustomersPage from '../pages/staff/StaffCustomersPage';
import StaffCustomerDetailPage from '../pages/staff/StaffCustomerDetailPage';
import StaffPendingDuesPage from '../pages/staff/StaffPendingDuesPage';
import MySummaryPage from '../pages/staff/MySummaryPage';
import AccountPage from '../pages/account/AccountPage';
import OverviewPage from '../pages/superAdmin/OverviewPage';
import OnboardingFunnelPage from '../pages/superAdmin/OnboardingFunnelPage';
import OrganizationsPage from '../pages/superAdmin/OrganizationsPage';
import OrganizationDetailPage from '../pages/superAdmin/OrganizationDetailPage';
import AuditLogPage from '../pages/superAdmin/AuditLogPage';

function RootRedirect() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
}

// Products/Routes/Stock are optional modules (see AppLayout.jsx's nav
// filtering) — hiding their nav link isn't enough on its own, since a direct
// URL visit would still render the page. Redirects to the dashboard if the
// org hasn't turned the module on.
function RequireModule({ flag }) {
  const { organization } = useAuth();
  if (!organization?.[flag]) return <Navigate to="/admin/dashboard" replace />;
  return <Outlet />;
}

// Same idea as RequireModule, but for the per-org delivery model the Super
// Admin picks (organization.delivery_model): pages that only make sense in one
// model — Vehicles for vehicle_eod, route ordering for route_staff — bounce
// to the dashboard under the other, instead of rendering a page that would
// have nothing meaningful to show.
function RequireDeliveryModel({ model, redirectTo = '/admin/dashboard' }) {
  const { organization } = useAuth();
  if ((organization?.delivery_model || 'route_staff') !== model) return <Navigate to={redirectTo} replace />;
  return <Outlet />;
}

// /staff/home is the staff member's main working screen, and what it is
// depends on the org's delivery model: the live route sheet, or the
// end-of-day vehicle entry form.
function StaffHome() {
  const { organization } = useAuth();
  return organization?.delivery_model === 'vehicle_eod' ? <VehicleEodEntryPage /> : <DailyRunSheetPage />;
}

// Same path, two experiences: route staff keep their simple "My Pending" list of
// assigned customers; office staff in a vehicle_eod org get the full dues
// workspace (by customer / delivery / vehicle, with payments).
function StaffPending() {
  const { organization } = useAuth();
  return organization?.delivery_model === 'vehicle_eod' ? <StaffPendingDuesPage /> : <MyPendingPage />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RootRedirect />} />
      {/* Public, unauthenticated — see backend/src/routes/portal.routes.js. */}
      <Route path="/portal/:token" element={<PortalPage />} />

      <Route element={<ProtectedRoute allowedRoles={['org_admin']} />}>
        <Route element={<AppLayout />}>
          <Route path="/admin/dashboard" element={<DashboardPage />} />
          <Route path="/admin/onboarding" element={<OnboardingWizardPage />} />
          <Route path="/admin/customers" element={<CustomersPage />} />
          <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/admin/staff" element={<StaffPage />} />
          <Route element={<RequireDeliveryModel model="vehicle_eod" />}>
            <Route path="/admin/vehicles" element={<VehiclesPage />} />
          </Route>
          <Route path="/admin/deliveries" element={<DeliveriesPage />} />
          <Route path="/admin/pending-dues" element={<PendingDuesPage />} />
          <Route element={<RequireModule flag="products_enabled" />}>
            <Route path="/admin/products" element={<ProductsPage />} />
          </Route>
          <Route element={<RequireModule flag="stock_enabled" />}>
            <Route path="/admin/stock" element={<StockPage />} />
          </Route>
          <Route element={<RequireModule flag="routes_enabled" />}>
            <Route element={<RequireDeliveryModel model="route_staff" />}>
              <Route path="/admin/routes" element={<RouteReorderPage />} />
            </Route>
          </Route>
          <Route path="/admin/reports" element={<ReportsPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allowedRoles={['staff']} />}>
        <Route element={<AppLayout />}>
          <Route path="/staff/home" element={<StaffHome />} />
          <Route path="/staff/pending" element={<StaffPending />} />
          <Route element={<RequireDeliveryModel model="vehicle_eod" redirectTo="/staff/home" />}>
            <Route path="/staff/customers" element={<StaffCustomersPage />} />
            <Route path="/staff/customers/:id" element={<StaffCustomerDetailPage />} />
          </Route>
          <Route path="/staff/summary" element={<MySummaryPage />} />
          <Route path="/staff/settings" element={<AccountPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
        <Route element={<AppLayout />}>
          <Route path="/super-admin/overview" element={<OverviewPage />} />
          <Route path="/super-admin/onboarding-funnel" element={<OnboardingFunnelPage />} />
          <Route path="/super-admin/organizations" element={<OrganizationsPage />} />
          <Route path="/super-admin/organizations/:id" element={<OrganizationDetailPage />} />
          <Route path="/super-admin/audit-log" element={<AuditLogPage />} />
          <Route path="/super-admin/settings" element={<AccountPage />} />
        </Route>
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
