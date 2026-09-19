const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');
const { unwrapPage } = unwrap;
const { parsePagination } = require('../utils/paginate');
const { isLitreUnit } = require('../utils/units');

// Paginated like every other list endpoint (customers, staff, deliveries) —
// callers that just want "every active product" for a picker dropdown
// (DeliveriesPage, DailyRunSheetPage, CustomerDetailPage) pass a large
// page_size and read .data, same idiom already used for the staff picker.
const list = asyncHandler(async (req, res) => {
  const { include_inactive } = req.query;
  const pg = parsePagination(req.query);
  let query = supabase.from('products').select('*', { count: 'exact' }).eq('organization_id', requireOrgId(req));
  if (!include_inactive) query = query.eq('is_active', true);
  const { data, count } = unwrapPage(await query.order('name', { ascending: true }).range(pg.from, pg.to));
  res.json(pg.buildResult(data, count));
});

const DEFAULT_QUANTITY_ERROR = 'A default quantity can only be set on a litre product';

const create = asyncHandler(async (req, res) => {
  const { name, unit_of_measure, default_price, reorder_level, default_quantity } = req.body;

  if (default_quantity !== undefined && default_quantity !== null && !isLitreUnit(unit_of_measure)) {
    throw ApiError.badRequest(DEFAULT_QUANTITY_ERROR);
  }

  const product = unwrap(await supabase.from('products').insert({
    organization_id: req.user.organizationId,
    name,
    unit_of_measure,
    default_price: default_price || 0,
    reorder_level: reorder_level ?? null,
    default_quantity: default_quantity ?? null,
  }).select('*').single());

  res.status(201).json(product);
});

const update = asyncHandler(async (req, res) => {
  const existing = unwrap(await supabase.from('products').select('*').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, existing);

  const { name, unit_of_measure, default_price, is_active, reorder_level, default_quantity } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (unit_of_measure !== undefined) patch.unit_of_measure = unit_of_measure;
  if (is_active !== undefined) patch.is_active = is_active;
  if (default_price !== undefined) patch.default_price = default_price;
  if (reorder_level !== undefined) patch.reorder_level = reorder_level;

  // default_quantity belongs to litre products only. Changing a product to
  // another unit clears it; setting one on a non-litre product is refused.
  const effectiveUnit = unit_of_measure !== undefined ? unit_of_measure : existing.unit_of_measure;
  if (default_quantity !== undefined) {
    if (default_quantity !== null && !isLitreUnit(effectiveUnit)) throw ApiError.badRequest(DEFAULT_QUANTITY_ERROR);
    patch.default_quantity = default_quantity;
  } else if (!isLitreUnit(effectiveUnit)) {
    patch.default_quantity = null;
  }

  const product = unwrap(await supabase.from('products').update(patch).eq('id', req.params.id).select('*').single());

  // Every default_price change gets its own row — the only way to answer
  // "when did I change from ₹40 to ₹45?" later — never edited after the fact.
  if (default_price !== undefined && parseFloat(default_price) !== parseFloat(existing.default_price)) {
    unwrap(await supabase.from('price_history').insert({
      organization_id: req.user.organizationId,
      product_id: product.id,
      old_price: existing.default_price,
      new_price: default_price,
      changed_by: req.user.id,
    }));
  }

  res.json(product);
});

const priceHistory = asyncHandler(async (req, res) => {
  const product = unwrap(await supabase.from('products').select('id, organization_id').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, product);

  const history = unwrap(await supabase
    .from('price_history')
    .select('*, changed_by_user:users(id, name)')
    .eq('product_id', req.params.id)
    .order('changed_at', { ascending: false }));

  res.json(history);
});

// Bulk-updates already-logged deliveries in a date range to a new unit price
// (and recomputes their total_amount, keeping amount_paid as-is so payment
// status is re-derived rather than assumed). This deliberately rewrites
// financial history, so it's a separate, explicit action from the normal
// price change above — never automatic.
const applyPriceRetroactively = asyncHandler(async (req, res) => {
  const product = unwrap(await supabase.from('products').select('id, organization_id').eq('id', req.params.id).maybeSingle());
  assertSameOrg(req, product);

  const { new_price, date_from, date_to } = req.body;

  const deliveries = unwrap(await supabase
    .from('deliveries')
    .select('id, quantity, amount_paid, total_amount')
    .eq('organization_id', req.user.organizationId)
    .eq('product_id', req.params.id)
    .gte('delivery_date', date_from)
    .lte('delivery_date', date_to));

  let updatedCount = 0;
  for (const delivery of deliveries) {
    const newTotal = Math.round(parseFloat(delivery.quantity) * parseFloat(new_price) * 100) / 100;
    const amountPaid = parseFloat(delivery.amount_paid);
    const newStatus = amountPaid <= 0 ? 'pending' : amountPaid >= newTotal ? 'paid' : 'partial';
    unwrap(await supabase.from('deliveries').update({
      unit_price_at_delivery: new_price,
      total_amount: newTotal,
      payment_status: newStatus,
      edited_by: req.user.id,
    }).eq('id', delivery.id));
    updatedCount += 1;
  }

  unwrap(await supabase.from('price_history').insert({
    organization_id: req.user.organizationId,
    product_id: req.params.id,
    old_price: null,
    new_price,
    changed_by: req.user.id,
  }));

  res.json({ updated_deliveries: updatedCount });
});

module.exports = { list, create, update, priceHistory, applyPriceRetroactively };
