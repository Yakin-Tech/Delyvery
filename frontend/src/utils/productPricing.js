// A litre product carries two prices that describe the same thing: the price per
// litre (the one that is stored, and that every delivery multiplies by) and the
// overall price of one default delivery (price per litre × default litres). The
// product form keeps them in step. Both helpers return '' when there is not yet
// enough to work out (so callers can leave the other field alone).

// Matches products.default_price (numeric(14, 6)): six decimals keep
// litres × price exact to the paisa for any tanker-sized delivery.
const UNIT_PRICE_DECIMALS = 6;

function positive(value) {
  const number = parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function overallFromUnit(unitPrice, litres) {
  const unit = parseFloat(unitPrice);
  const quantity = positive(litres);
  if (!Number.isFinite(unit) || quantity === null) return '';
  return (unit * quantity).toFixed(2);
}

export function unitFromOverall(overall, litres) {
  const total = parseFloat(overall);
  const quantity = positive(litres);
  if (!Number.isFinite(total) || quantity === null) return '';
  return String(Number((total / quantity).toFixed(UNIT_PRICE_DECIMALS)));
}
