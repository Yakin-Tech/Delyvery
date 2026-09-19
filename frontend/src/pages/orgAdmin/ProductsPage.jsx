import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listProducts, createProduct, updateProduct, getPriceHistory, applyPriceRetroactively } from '../../api/products.api';
import Button from '../../components/common/Button';
import IconButton from '../../components/common/IconButton';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import Table from '../../components/common/Table';
import Badge from '../../components/common/Badge';
import Spinner from '../../components/common/Spinner';
import Pagination from '../../components/common/Pagination';
import { UNIT_VALUES, unitLabel, isLitreUnit } from '../../utils/businessTypes';
import { formatCurrency, formatUnitPrice, formatDate } from '../../utils/paymentStatus';
import { overallFromUnit, unitFromOverall } from '../../utils/productPricing';

const KNOWN_UNITS = UNIT_VALUES.filter((v) => v !== 'other');
// default_price is the price per unit (per litre for a litre product); total_price is the
// overall price of one default delivery and only exists on screen — it is always
// default_price × default_quantity. priceAnchor is whichever of the two was typed last:
// it stays put when the litres change, and the other one follows.
const emptyForm = { name: '', unit_of_measure: 'litre', unit_of_measure_other: '', default_price: '', total_price: '', priceAnchor: 'unit', reorder_level: '', default_quantity: '' };

export default function ProductsPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [history, setHistory] = useState([]);
  const [retroTarget, setRetroTarget] = useState(null);
  const [retroForm, setRetroForm] = useState({ new_price: '', date_from: '', date_to: '' });
  const [retroError, setRetroError] = useState('');
  const [retroSaving, setRetroSaving] = useState(false);
  const [retroResult, setRetroResult] = useState(null);

  async function load(pageNum = 1, size = pageSize) {
    setLoading(true);
    try {
      const result = await listProducts({ include_inactive: true, page: pageNum, page_size: size });
      setProducts(result.data);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(nextPage) {
    load(nextPage);
  }

  function handlePageSizeChange(nextSize) {
    setPageSize(nextSize);
    load(1, nextSize);
  }

  function toFormShape(product) {
    const isKnown = KNOWN_UNITS.includes(product?.unit_of_measure);
    return {
      name: product?.name || '',
      unit_of_measure: isKnown ? product.unit_of_measure : 'other',
      unit_of_measure_other: isKnown ? '' : (product?.unit_of_measure || ''),
      default_price: product?.default_price ?? '',
      total_price: overallFromUnit(product?.default_price, product?.default_quantity),
      priceAnchor: 'unit',
      reorder_level: product?.reorder_level ?? '',
      default_quantity: product?.default_quantity ?? '',
      is_active: product?.is_active ?? true,
    };
  }

  function changeUnitPrice(value) {
    setForm((f) => ({ ...f, default_price: value, priceAnchor: 'unit', total_price: overallFromUnit(value, f.default_quantity) }));
  }

  function changeTotalPrice(value) {
    setForm((f) => {
      const unitPrice = unitFromOverall(value, f.default_quantity);
      return { ...f, total_price: value, priceAnchor: 'total', default_price: unitPrice !== '' ? unitPrice : f.default_price };
    });
  }

  function changeDefaultLitres(value) {
    setForm((f) => {
      const next = { ...f, default_quantity: value };
      if (f.priceAnchor === 'total') {
        const unitPrice = unitFromOverall(f.total_price, value);
        if (unitPrice !== '') next.default_price = unitPrice;
      } else {
        next.total_price = overallFromUnit(f.default_price, value);
      }
      return next;
    });
  }

  function openCreate() {
    setForm(emptyForm);
    setError('');
    setShowCreate(true);
  }

  function openEdit(product) {
    setEditTarget(product);
    setForm(toFormShape(product));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const unit_of_measure = form.unit_of_measure === 'other' ? (form.unit_of_measure_other || 'other') : form.unit_of_measure;
      const payload = {
        name: form.name,
        unit_of_measure,
        default_price: form.default_price || 0,
        reorder_level: form.reorder_level === '' ? null : form.reorder_level,
        // Only litre products can carry a default quantity; anything else clears it.
        default_quantity: isLitreUnit(unit_of_measure) && form.default_quantity !== '' ? form.default_quantity : null,
      };
      if (editTarget) {
        payload.is_active = form.is_active;
        await updateProduct(editTarget.id, payload);
        setEditTarget(null);
        await load(pagination?.page || 1);
      } else {
        await createProduct(payload);
        setShowCreate(false);
        await load(1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(product) {
    setHistoryTarget(product);
    setHistory(await getPriceHistory(product.id));
  }

  function openRetro(product) {
    setRetroTarget(product);
    setRetroForm({ new_price: product.default_price, date_from: '', date_to: '' });
    setRetroError('');
    setRetroResult(null);
  }

  async function handleRetroSubmit(e) {
    e.preventDefault();
    setRetroError('');
    setRetroSaving(true);
    try {
      const result = await applyPriceRetroactively(retroTarget.id, retroForm);
      setRetroResult(result.updated_deliveries);
    } catch (err) {
      setRetroError(err.message);
    } finally {
      setRetroSaving(false);
    }
  }

  // The overall-price column only means something once a litre product has default litres.
  const showOverallPrice = products.some((p) => p.default_quantity);

  const columns = [
    { key: 'name', header: t('products.columns.name') },
    { key: 'unit_of_measure', header: t('products.columns.unit'), render: (r) => unitLabel(r.unit_of_measure, t) },
    { key: 'default_quantity', header: t('products.columns.defaultQuantity'), render: (r) => r.default_quantity ?? '—' },
    { key: 'default_price', header: t('products.columns.price'), render: (r) => formatUnitPrice(r.default_price) },
    ...(showOverallPrice ? [{
      key: 'overall_price',
      header: t('products.columns.overallPrice'),
      render: (r) => (r.default_quantity ? formatCurrency(r.default_price * r.default_quantity) : '—'),
    }] : []),
    { key: 'reorder_level', header: t('products.modal.reorderLevel'), render: (r) => r.reorder_level ?? '—' },
    { key: 'status', header: t('common.status'), render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
    {
      key: 'actions',
      header: t('deliveries.columns.actions'),
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <IconButton icon="edit" label={t('common.edit')} onClick={() => openEdit(r)} />
          <Button variant="ghost" onClick={() => openHistory(r)}>{t('products.priceHistory')}</Button>
          <Button variant="ghost" onClick={() => openRetro(r)}>{t('products.applyRetroactively')}</Button>
        </div>
      ),
    },
  ];

  const modalOpen = showCreate || !!editTarget;
  const formIsLitre = isLitreUnit(form.unit_of_measure === 'other' ? form.unit_of_measure_other : form.unit_of_measure);

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('products.title')}</h1>
        <Button onClick={openCreate}>{t('products.addProduct')}</Button>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <>
            <Table columns={columns} rows={products} rowKey={(r) => r.id} emptyMessage={t('products.empty')} />
            <Pagination pagination={pagination} onPageChange={handlePageChange} pageSize={pageSize} onPageSizeChange={handlePageSizeChange} />
          </>
        )}
      </div>

      {modalOpen && (
        <Modal title={editTarget ? t('products.modal.editTitle') : t('products.modal.addTitle')} onClose={() => { setShowCreate(false); setEditTarget(null); }}>
          <form onSubmit={handleSubmit}>
            <div className="formGrid">
              <TextInput label={t('common.name')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select label={t('products.modal.unit')} value={form.unit_of_measure} onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })}>
                {UNIT_VALUES.map((v) => <option key={v} value={v}>{t(`units.${v}`)}</option>)}
              </Select>
              {form.unit_of_measure === 'other' && (
                <TextInput label={t('settings.unitPlaceholder')} required value={form.unit_of_measure_other} onChange={(e) => setForm({ ...form, unit_of_measure_other: e.target.value })} />
              )}
              {formIsLitre && (
                <TextInput
                  label={`${t('products.modal.defaultQuantity')} (${t('common.optional')})`}
                  type="number" inputMode="decimal" step="0.01" min="0.01"
                  value={form.default_quantity}
                  onChange={(e) => changeDefaultLitres(e.target.value)}
                />
              )}
              <TextInput
                label={formIsLitre ? t('products.modal.pricePerLitre') : t('products.modal.defaultPrice')}
                type="number" inputMode="decimal" step="any" min="0"
                value={form.default_price}
                onChange={(e) => changeUnitPrice(e.target.value)}
              />
              {formIsLitre && (
                <TextInput
                  label={t('products.modal.overallPrice')}
                  type="number" inputMode="decimal" step="0.01" min="0"
                  disabled={!(parseFloat(form.default_quantity) > 0)}
                  value={form.total_price}
                  onChange={(e) => changeTotalPrice(e.target.value)}
                />
              )}
              <TextInput
                label={`${t('products.modal.reorderLevel')} (${t('common.optional')})`}
                type="number" min="0" step="1"
                value={form.reorder_level}
                onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
              />
            </div>
            {formIsLitre && (
              <>
                <p className="mutedText" style={{ marginBottom: 0 }}>{t('products.modal.defaultQuantityHint')}</p>
                <p className="mutedText" style={{ marginBottom: 0 }}>
                  {parseFloat(form.default_quantity) > 0 ? t('products.modal.priceLinkHint') : t('products.modal.overallPriceNeedsLitres')}
                </p>
              </>
            )}
            {editTarget && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                {t('products.modal.isActive')}
              </label>
            )}
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => { setShowCreate(false); setEditTarget(null); }}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {historyTarget && (
        <Modal title={`${t('products.priceHistory')} — ${historyTarget.name}`} onClose={() => setHistoryTarget(null)}>
          {history.length === 0 ? <p className="mutedText">{t('products.noHistory')}</p> : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((h) => (
                <li key={h.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
                  <span>{h.old_price !== null ? `${formatUnitPrice(h.old_price)} → ${formatUnitPrice(h.new_price)}` : formatUnitPrice(h.new_price)}</span>
                  <span className="mutedText">{formatDate(h.changed_at)} · {h.changed_by_user?.name || '—'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="formActions">
            <Button type="button" variant="secondary" onClick={() => setHistoryTarget(null)}>{t('common.close')}</Button>
          </div>
        </Modal>
      )}

      {retroTarget && (
        <Modal title={`${t('products.applyRetroactively')} — ${retroTarget.name}`} onClose={() => setRetroTarget(null)}>
          {retroResult !== null ? (
            <>
              <p>{t('products.retroSuccess', { count: retroResult })}</p>
              <div className="formActions">
                <Button type="button" onClick={() => setRetroTarget(null)}>{t('common.close')}</Button>
              </div>
            </>
          ) : (
            <form onSubmit={handleRetroSubmit}>
              <p className="mutedText" style={{ marginTop: 0, fontWeight: 600 }}>{t('products.retroWarning')}</p>
              <div className="formGrid">
                <TextInput label={t('products.modal.defaultPrice')} type="number" step="any" min="0" required value={retroForm.new_price} onChange={(e) => setRetroForm({ ...retroForm, new_price: e.target.value })} />
                <TextInput label={t('deliveries.filters.from')} type="date" required value={retroForm.date_from} onChange={(e) => setRetroForm({ ...retroForm, date_from: e.target.value })} />
                <TextInput label={t('deliveries.filters.to')} type="date" required value={retroForm.date_to} onChange={(e) => setRetroForm({ ...retroForm, date_to: e.target.value })} />
              </div>
              {retroError && <p className="errorText">{retroError}</p>}
              <div className="formActions">
                <Button type="submit" variant="danger" disabled={retroSaving}>{retroSaving ? t('common.saving') : t('products.confirmRetroactive')}</Button>
                <Button type="button" variant="secondary" onClick={() => setRetroTarget(null)}>{t('common.cancel')}</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
