import { totalFromUnitPrice, unitPriceFromTotal, quantityForProduct } from './deliveryAmounts';

// The state of one delivery being keyed in — used by the end-of-day entry page
// and by the admin's "add delivery" dialog. Each `apply…` takes the entry as it
// is and returns the next one (never mutates), so they drop straight into a
// setState updater. `priceMode` remembers whether price-per-unit or the total was
// typed last, which is the one that stays fixed when the quantity changes.

export function blankEntry(organization) {
  const unitPrice = organization?.default_price_per_unit ?? 0;
  return {
    customerSelection: null,
    product_id: '',
    quantity: 1,
    unit_price: unitPrice,
    total_amount: totalFromUnitPrice(1, unitPrice),
    priceMode: 'unit_price',
    payment_status: 'paid',
    amount_paid: '',
    payment_mode: 'cash',
    notes: '',
  };
}

// Choosing an existing customer brings in their usual quantity and price.
export function applyCustomer(entry, selection, organization) {
  const next = { ...entry, customerSelection: selection };
  if (selection?.mode === 'existing') {
    next.quantity = selection.customer?.default_quantity ?? entry.quantity;
    next.unit_price = selection.customer?.custom_price_per_unit ?? organization?.default_price_per_unit ?? entry.unit_price;
    next.priceMode = 'unit_price';
    next.total_amount = totalFromUnitPrice(next.quantity, next.unit_price) || entry.total_amount;
  }
  return next;
}

// A litre product with a default quantity ("Tanker 2000 Ltr") fills it in.
export function applyProduct(entry, product) {
  const unitPrice = product ? product.default_price : entry.unit_price;
  const quantity = quantityForProduct(product, entry.quantity);
  return {
    ...entry,
    product_id: product ? product.id : '',
    quantity,
    unit_price: unitPrice,
    priceMode: 'unit_price',
    total_amount: totalFromUnitPrice(quantity, unitPrice) || entry.total_amount,
  };
}

export function applyQuantity(entry, value) {
  const next = { ...entry, quantity: value };
  if (entry.priceMode === 'total_amount') {
    const computed = unitPriceFromTotal(value, entry.total_amount);
    if (computed !== '') next.unit_price = computed;
  } else {
    const computed = totalFromUnitPrice(value, entry.unit_price);
    if (computed !== '') next.total_amount = computed;
  }
  return next;
}

export function applyUnitPrice(entry, value) {
  const next = { ...entry, unit_price: value, priceMode: 'unit_price' };
  const computed = totalFromUnitPrice(entry.quantity, value);
  if (computed !== '') next.total_amount = computed;
  return next;
}

export function applyTotal(entry, value) {
  const next = { ...entry, total_amount: value, priceMode: 'total_amount' };
  const computed = unitPriceFromTotal(entry.quantity, value);
  if (computed !== '') next.unit_price = computed;
  return next;
}

export function entryAmounts(entry) {
  const total = parseFloat(entry.total_amount) || 0;
  let paid = 0;
  if (entry.payment_status === 'paid') paid = total;
  else if (entry.payment_status === 'partial') paid = parseFloat(entry.amount_paid) || 0;
  return { total, paid, pending: Math.max(total - paid, 0) };
}

// Returns { field, message } for the first problem (field = the input to focus),
// or null when the entry is good to save.
export function validateEntry(entry, t) {
  const selection = entry.customerSelection;
  if (!selection || (selection.mode === 'new' && !selection.name.trim())) return { field: 'customer', message: t('eod.errors.customerRequired') };
  if (!(parseFloat(entry.quantity) > 0)) return { field: 'quantity', message: t('eod.errors.quantityRequired') };
  const total = parseFloat(entry.total_amount);
  if (Number.isNaN(total) || total < 0) return { field: 'total_amount', message: t('eod.errors.priceRequired') };
  if (entry.payment_status === 'partial') {
    const paid = parseFloat(entry.amount_paid);
    if (!(paid > 0) || paid >= total) return { field: 'amount_paid', message: t('eod.errors.partialInvalid') };
  }
  return null;
}

// The fields every "record a delivery" API call shares, from an entry.
export function entryPayload(entry) {
  const selection = entry.customerSelection;
  const unitPrice = entry.unit_price !== '' ? entry.unit_price : unitPriceFromTotal(entry.quantity, entry.total_amount);
  const payload = {
    product_id: entry.product_id || undefined,
    quantity: entry.quantity,
    unit_price: unitPrice,
    total_amount: entry.total_amount,
    payment_status: entry.payment_status,
    amount_paid: entry.payment_status === 'partial' ? entry.amount_paid : undefined,
    payment_mode: entry.payment_status === 'pending' ? undefined : entry.payment_mode,
    notes: entry.notes || undefined,
  };
  if (selection?.mode === 'existing') payload.customer_id = selection.customer_id;
  else if (selection?.mode === 'new') payload.new_customer = { name: selection.name.trim(), phone: selection.phone?.trim() || undefined };
  return payload;
}
