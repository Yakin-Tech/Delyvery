const ApiError = require('../utils/ApiError');

// Recording payments and working the dues lists is office work in a vehicle_eod
// org, so staff get it there. In a route_staff org it stays an admin job (staff
// there have their own "My Pending" list), so this closes the door for them.
// org_admin always passes. Must run after authenticate (it reads req.organization).
function staffOnlyInVehicleOrgs(req, res, next) {
  if (req.user.role === 'staff' && req.organization?.delivery_model !== 'vehicle_eod') {
    return next(ApiError.forbidden('This is not available for your organization'));
  }
  return next();
}

module.exports = staffOnlyInVehicleOrgs;
