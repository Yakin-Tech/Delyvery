const supabase = require('../config/supabaseClient');
const { requireOrgId, assertSameOrg } = require('../middleware/scopeToOrg');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const unwrap = require('../utils/unwrap');

// Current stock is always derived from the full movement history rather than
// stored, so it can never drift out of sync with the ledger — see the
// schema.sql comment on stock_movements for why.
function currentStock(movements) {
  return movements.reduce((total, m) => {
    const qty = parseFloat(m.quantity);
    if (m.movement_type === 'out') return total - qty;
    return total + qty;
  }, 0);
}

const listForProduct = asyncHandler(async (req, res) => {
  const product = unwrap(await supabase.from('products').select('id, organization_id').eq('id', req.params.productId).maybeSingle());
  assertSameOrg(req, product);

  const movements = unwrap(await supabase
    .from('stock_movements')
    .select('*')
    .eq('product_id', req.params.productId)
    .order('movement_date', { ascending: false })
    .order('created_at', { ascending: false }));

  res.json({ movements, current_stock: currentStock(movements) });
});

const summary = asyncHandler(async (req, res) => {
  const products = unwrap(await supabase.from('products').select('id, name, unit_of_measure, reorder_level').eq('organization_id', requireOrgId(req)).eq('is_active', true));
  const movements = unwrap(await supabase.from('stock_movements').select('product_id, movement_type, quantity').eq('organization_id', requireOrgId(req)));

  const byProduct = new Map();
  for (const m of movements) {
    const list = byProduct.get(m.product_id) || [];
    list.push(m);
    byProduct.set(m.product_id, list);
  }

  res.json(products.map((p) => {
    const stock = currentStock(byProduct.get(p.id) || []);
    return {
      product: p,
      current_stock: stock,
      // Null reorder_level means alerting is off for this product (most orgs
      // don't track stock at all) — see the schema.sql comment on
      // products.reorder_level.
      low_stock: p.reorder_level != null && stock <= p.reorder_level,
    };
  }));
});

const create = asyncHandler(async (req, res) => {
  const product = unwrap(await supabase.from('products').select('id, organization_id').eq('id', req.body.product_id).maybeSingle());
  assertSameOrg(req, product);

  const movement = unwrap(await supabase.from('stock_movements').insert({
    organization_id: req.user.organizationId,
    product_id: req.body.product_id,
    movement_type: req.body.movement_type,
    quantity: req.body.quantity,
    movement_date: req.body.movement_date || undefined,
    reference_delivery_id: req.body.reference_delivery_id || null,
    notes: req.body.notes || null,
    recorded_by: req.user.id,
  }).select('*').single());

  res.status(201).json(movement);
});

module.exports = { listForProduct, summary, create };
