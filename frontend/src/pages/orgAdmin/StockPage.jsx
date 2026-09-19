import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getStockSummary, listStockForProduct, createStockMovement } from '../../api/stock.api';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Modal from '../../components/common/Modal';
import Table from '../../components/common/Table';
import Spinner from '../../components/common/Spinner';
import { formatDate } from '../../utils/paymentStatus';

const emptyForm = { product_id: '', movement_type: 'received_from_supplier', quantity: '', movement_date: '', notes: '' };

export default function StockPage() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [movements, setMovements] = useState([]);

  async function load() {
    setLoading(true);
    try {
      setSummary(await getStockSummary());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ ...emptyForm, product_id: summary[0]?.product.id || '' });
    setError('');
    setShowCreate(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createStockMovement(form);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(row) {
    setHistoryTarget(row);
    const result = await listStockForProduct(row.product.id);
    setMovements(result.movements);
  }

  const columns = [
    { key: 'name', header: t('products.columns.name'), render: (r) => r.product.name },
    { key: 'unit', header: t('products.columns.unit'), render: (r) => r.product.unit_of_measure },
    { key: 'current_stock', header: t('stock.currentStock'), render: (r) => <strong>{r.current_stock}</strong> },
    { key: 'actions', header: t('deliveries.columns.actions'), render: (r) => <Button variant="ghost" onClick={() => openHistory(r)}>{t('stock.viewMovements')}</Button> },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('stock.title')}</h1>
        <Button onClick={openCreate}>{t('stock.addMovement')}</Button>
      </div>

      <p className="mutedText">{t('stock.hint')}</p>

      <div className="card">
        {loading ? <Spinner /> : <Table columns={columns} rows={summary} rowKey={(r) => r.product.id} emptyMessage={t('stock.empty')} />}
      </div>

      {showCreate && (
        <Modal title={t('stock.addMovement')} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleSubmit}>
            <div className="formGrid">
              <Select label={t('common.product')} required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                {summary.map((r) => <option key={r.product.id} value={r.product.id}>{r.product.name}</option>)}
              </Select>
              <Select label={t('stock.movementType')} value={form.movement_type} onChange={(e) => setForm({ ...form, movement_type: e.target.value })}>
                <option value="received_from_supplier">{t('stock.types.received')}</option>
                <option value="out">{t('stock.types.out')}</option>
                <option value="return">{t('stock.types.return')}</option>
              </Select>
              <TextInput label={t('deliveries.modal.quantity')} type="number" step="0.01" min="0.01" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              <TextInput label={t('deliveries.filters.from')} type="date" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} />
            </div>
            <TextInput label={`${t('common.notes')} (${t('common.optional')})`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ marginTop: 16 }} />
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {historyTarget && (
        <Modal title={`${t('stock.viewMovements')} — ${historyTarget.product.name}`} onClose={() => setHistoryTarget(null)}>
          {movements.length === 0 ? <p className="mutedText">{t('stock.empty')}</p> : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {movements.map((m) => (
                <li key={m.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
                  <span>{t(`stock.types.${m.movement_type === 'received_from_supplier' ? 'received' : m.movement_type}`)} — {m.quantity}</span>
                  <span className="mutedText">{formatDate(m.movement_date)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="formActions">
            <Button type="button" variant="secondary" onClick={() => setHistoryTarget(null)}>{t('common.close')}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
