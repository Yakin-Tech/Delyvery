// Single source of truth for each role's landing route — shared by
// AppRoutes.jsx (redirecting "/") and ProtectedRoute.jsx (redirecting a user
// away from a route their role can't access), so the two can never drift
// out of sync with each other again.
export const HOME_BY_ROLE = {
  org_admin: '/admin/dashboard',
  staff: '/staff/home',
  super_admin: '/super-admin/overview',
};
