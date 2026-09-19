// Shared bidirectional calculation for delivery forms: given a quantity, entering
// either "price per unit" or "total amount" computes the other. Returns '' when
// there isn't enough info yet to compute (so callers can skip overwriting).
export function totalFromUnitPrice(quantity, unitPrice) {
  const qty = parseFloat(quantity);
  const price = parseFloat(unitPrice);
  if (Number.isNaN(qty) || Number.isNaN(price)) return '';
  return (qty * price).toFixed(2);
}

// A litre product can carry a default quantity (products.default_quantity — e.g.
// "Tanker 2000 Ltr" → 2000). Picking such a product on a delivery form fills the
// quantity in; a product without one leaves whatever quantity was already there.
export function quantityForProduct(product, currentQuantity) {
  const fallback = product ? Number(product.default_quantity) : NaN;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : currentQuantity;
}

export function unitPriceFromTotal(quantity, totalAmount) {
  const qty = parseFloat(quantity);
  const total = parseFloat(totalAmount);
  if (Number.isNaN(qty) || qty <= 0 || Number.isNaN(total)) return '';
  return (total / qty).toFixed(2);
}
