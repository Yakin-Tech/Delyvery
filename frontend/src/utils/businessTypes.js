export const BUSINESS_TYPE_VALUES = ['water', 'milk', 'gas', 'other'];

// value is 'water'/'milk'/'gas'/'other', or a free-text custom label the org
// admin typed when they picked "other" — only translate the known keys.
export function businessTypeLabel(value, t) {
  return BUSINESS_TYPE_VALUES.includes(value) ? t(`businessTypes.${value}`) : value;
}

export const ORG_STATUS_OPTIONS = ['trial', 'active', 'suspended', 'expired'];

export const ORG_STATUS_TONE = {
  trial: 'neutral',
  active: 'success',
  suspended: 'danger',
  expired: 'warning',
};

export function orgStatusLabel(status, t) {
  return status === 'active' ? t('common.active') : t(`badges.${status}`);
}

// How an organization records deliveries (organizations.delivery_model), chosen
// by the Super Admin — not to be confused with delivery *modes* below (can /
// lorry / tempo), which are free-form tags the org admin picks in Settings.
export const DELIVERY_MODEL_VALUES = ['route_staff', 'vehicle_eod'];

export function deliveryModelLabel(value, t) {
  return t(`superAdmin.deliveryModels.${value === 'vehicle_eod' ? 'vehicle_eod' : 'route_staff'}`);
}

// Same list as backend/src/utils/units.js — a unit typed in by hand ("Ltr",
// "Litres") counts as litre too. Gates the "default litres" product field.
const LITRE_UNITS = ['litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs', 'l'];

export function isLitreUnit(unit) {
  return LITRE_UNITS.includes(String(unit || '').trim().toLowerCase());
}

export const UNIT_VALUES = ['litre', 'can', 'packet', 'cylinder', 'kg', 'other'];

// value is one of the known presets, or a free-text custom unit the org admin
// typed when they picked "other" — only translate the known keys.
export function unitLabel(value, t) {
  return UNIT_VALUES.includes(value) ? t(`units.${value}`) : value;
}

// The unit this organization sells in, ready to show ("Litre", or whatever custom unit it typed).
export function orgUnitLabel(organization, t) {
  return unitLabel(organization?.unit_of_measure || 'litre', t);
}

// Delivery modes aren't a single pick — an org can use several at once
// (e.g. can + lorry), and can add ones we never anticipated (this list is
// just the starting presets shown as toggle chips in Settings).
export const DELIVERY_MODE_PRESETS = ['can', 'lorry', 'tractor', 'tempo'];

export function deliveryModeLabel(value, t) {
  return DELIVERY_MODE_PRESETS.includes(value) ? t(`deliveryModes.${value}`) : value;
}
