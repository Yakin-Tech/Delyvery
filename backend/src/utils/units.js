// A product's unit_of_measure is free text once "other" is picked, so a litre
// unit can arrive as 'litre', 'Litres', 'Ltr', 'L'... Anything that only makes
// sense for litre products (products.default_quantity) goes through this.
const LITRE_UNITS = new Set(['litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs', 'l']);

function isLitreUnit(unit) {
  return LITRE_UNITS.has(String(unit || '').trim().toLowerCase());
}

module.exports = { isLitreUnit };
