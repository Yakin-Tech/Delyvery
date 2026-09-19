import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { updateOwnOrganization, updateOnboarding } from '../../api/organization.api';
import { createProduct } from '../../api/products.api';
import { createCustomer } from '../../api/customers.api';
import { createStaff } from '../../api/staff.api';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import { UNIT_VALUES, DELIVERY_MODE_PRESETS } from '../../utils/businessTypes';
import styles from './OnboardingWizardPage.module.css';

const STEP_KEYS = ['business', 'products', 'delivery', 'customers', 'staff'];

const emptyProductRow = { name: '', default_price: '' };
const emptyCustomerRow = { name: '', phone: '' };

export default function OnboardingWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organization, updateOrganization } = useAuth();

  const [stepIndex, setStepIndex] = useState(() => {
    const stored = organization?.onboarding_step || 0;
    return Math.min(Math.max(stored, 0), STEP_KEYS.length - 1);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — business basics
  const [unitOfMeasure, setUnitOfMeasure] = useState(organization?.unit_of_measure || 'litre');
  const [defaultPrice, setDefaultPrice] = useState(organization?.default_price_per_unit || '');

  // Step 2 — first products
  const [productRows, setProductRows] = useState([{ ...emptyProductRow }]);
  const [addedProducts, setAddedProducts] = useState([]);

  // Step 3 — delivery modes (optional)
  const [deliveryModes, setDeliveryModes] = useState(organization?.delivery_modes || []);

  // Step 4 — first customers
  const [customerMode, setCustomerMode] = useState('manual'); // 'manual' | 'csv'
  const [customerRows, setCustomerRows] = useState([{ ...emptyCustomerRow }, { ...emptyCustomerRow }, { ...emptyCustomerRow }]);
  const [csvText, setCsvText] = useState('');
  const [addedCustomerCount, setAddedCustomerCount] = useState(0);

  // Step 5 — first staff member
  const [staffForm, setStaffForm] = useState({ name: '', phone: '', password: '' });
  const [addedStaffCount, setAddedStaffCount] = useState(0);

  async function persistStep(nextIndex, completed = false) {
    const updated = await updateOnboarding({ step: nextIndex, completed });
    updateOrganization(updated);
  }

  async function goToStep(nextIndex) {
    if (nextIndex >= STEP_KEYS.length) {
      await persistStep(STEP_KEYS.length - 1, true);
      navigate('/admin/dashboard');
      return;
    }
    await persistStep(nextIndex);
    setStepIndex(nextIndex);
  }

  async function skipSetup() {
    setSaving(true);
    try {
      await persistStep(stepIndex, true);
      navigate('/admin/dashboard');
    } finally {
      setSaving(false);
    }
  }

  async function handleBusinessContinue() {
    setError('');
    setSaving(true);
    try {
      const updated = await updateOwnOrganization({ unit_of_measure: unitOfMeasure, default_price_per_unit: defaultPrice || 0 });
      updateOrganization(updated);
      await goToStep(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleProductsContinue() {
    setError('');
    setSaving(true);
    try {
      const rowsToSave = productRows.filter((r) => r.name.trim());
      for (const row of rowsToSave) {
        const created = await createProduct({ name: row.name, unit_of_measure: unitOfMeasure, default_price: row.default_price || 0 });
        setAddedProducts((prev) => [...prev, created]);
      }
      setProductRows([{ ...emptyProductRow }]);
      await goToStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleDeliveryMode(mode) {
    setDeliveryModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  }

  async function handleDeliveryContinue() {
    setError('');
    setSaving(true);
    try {
      const updated = await updateOwnOrganization({ delivery_modes: deliveryModes });
      updateOrganization(updated);
      await goToStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function parseCsv(text) {
    return text.split('\n').map((line) => line.split(',').map((v) => v.trim())).filter(([name]) => name)
      .map(([name, phone]) => ({ name, phone: phone || '' }));
  }

  async function handleCustomersContinue() {
    setError('');
    setSaving(true);
    try {
      const rows = customerMode === 'csv' ? parseCsv(csvText) : customerRows.filter((r) => r.name.trim());
      let created = 0;
      for (const row of rows) {
        try {
          await createCustomer({ name: row.name, phone: row.phone || undefined });
          created += 1;
        } catch {
          // One bad row (e.g. duplicate phone) shouldn't block the rest —
          // the org admin can fix it later from the Customers page.
        }
      }
      setAddedCustomerCount((prev) => prev + created);
      setCustomerRows([{ ...emptyCustomerRow }, { ...emptyCustomerRow }, { ...emptyCustomerRow }]);
      setCsvText('');
      await goToStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStaffContinue() {
    setError('');
    setSaving(true);
    try {
      if (staffForm.name.trim() && staffForm.phone.trim() && staffForm.password.trim()) {
        await createStaff(staffForm);
        setAddedStaffCount((prev) => prev + 1);
      }
      await goToStep(5);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const progressPct = Math.round(((stepIndex + 1) / STEP_KEYS.length) * 100);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{t('onboarding.title')}</h1>
          <p className="mutedText">{t('onboarding.estimate')}</p>
        </div>
        <Button variant="ghost" onClick={skipSetup} disabled={saving}>{t('onboarding.skipSetup')}</Button>
      </div>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
      </div>
      <p className="mutedText" style={{ marginBottom: 24 }}>{t('onboarding.stepOf', { step: stepIndex + 1, total: STEP_KEYS.length })}</p>

      <div className="card">
        {STEP_KEYS[stepIndex] === 'business' && (
          <>
            <h2>{t('onboarding.steps.business.title')}</h2>
            <p className="mutedText">{t('onboarding.steps.business.hint')}</p>
            <div className="formGrid" style={{ marginTop: 16 }}>
              <Select label={t('settings.unitOfMeasure')} value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)}>
                {UNIT_VALUES.map((v) => <option key={v} value={v}>{t(`units.${v}`)}</option>)}
              </Select>
              <TextInput label={t('settings.defaultPrice')} type="number" step="0.01" min="0" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} />
            </div>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button onClick={handleBusinessContinue} disabled={saving}>{t('onboarding.continue')}</Button>
            </div>
          </>
        )}

        {STEP_KEYS[stepIndex] === 'products' && (
          <>
            <h2>{t('onboarding.steps.products.title')}</h2>
            <p className="mutedText">{t('onboarding.steps.products.hint')}</p>
            {addedProducts.length > 0 && (
              <ul className={styles.addedList}>{addedProducts.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
            )}
            {productRows.map((row, i) => (
              <div className="formGrid" key={i} style={{ marginTop: 16 }}>
                <TextInput label={t('common.name')} value={row.name} onChange={(e) => setProductRows((rows) => rows.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))} />
                <TextInput label={t('products.modal.defaultPrice')} type="number" step="0.01" min="0" value={row.default_price} onChange={(e) => setProductRows((rows) => rows.map((r, idx) => idx === i ? { ...r, default_price: e.target.value } : r))} />
              </div>
            ))}
            <Button variant="ghost" onClick={() => setProductRows((rows) => [...rows, { ...emptyProductRow }])} style={{ marginTop: 8 }}>
              {t('onboarding.steps.products.addAnother')}
            </Button>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button onClick={handleProductsContinue} disabled={saving}>{t('onboarding.continue')}</Button>
              <Button variant="secondary" onClick={() => goToStep(2)} disabled={saving}>{t('onboarding.skipStep')}</Button>
            </div>
          </>
        )}

        {STEP_KEYS[stepIndex] === 'delivery' && (
          <>
            <h2>{t('onboarding.steps.delivery.title')}</h2>
            <p className="mutedText">{t('onboarding.steps.delivery.hint')}</p>
            <div className={styles.chipRow}>
              {DELIVERY_MODE_PRESETS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.chip} ${deliveryModes.includes(mode) ? styles.chipActive : ''}`}
                  onClick={() => toggleDeliveryMode(mode)}
                >
                  {t(`deliveryModes.${mode}`)}
                </button>
              ))}
            </div>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button onClick={handleDeliveryContinue} disabled={saving}>{t('onboarding.continue')}</Button>
              <Button variant="secondary" onClick={() => goToStep(3)} disabled={saving}>{t('onboarding.skipStep')}</Button>
            </div>
          </>
        )}

        {STEP_KEYS[stepIndex] === 'customers' && (
          <>
            <h2>{t('onboarding.steps.customers.title')}</h2>
            <p className="mutedText">{t('onboarding.steps.customers.hint')}</p>
            {addedCustomerCount > 0 && <p className="mutedText">{t('onboarding.steps.customers.added', { count: addedCustomerCount })}</p>}
            <div className={styles.chipRow} style={{ marginBottom: 16 }}>
              <button type="button" className={`${styles.chip} ${customerMode === 'manual' ? styles.chipActive : ''}`} onClick={() => setCustomerMode('manual')}>
                {t('onboarding.steps.customers.manualTab')}
              </button>
              <button type="button" className={`${styles.chip} ${customerMode === 'csv' ? styles.chipActive : ''}`} onClick={() => setCustomerMode('csv')}>
                {t('onboarding.steps.customers.csvTab')}
              </button>
            </div>
            {customerMode === 'manual' ? (
              customerRows.map((row, i) => (
                <div className="formGrid" key={i} style={{ marginTop: 12 }}>
                  <TextInput label={t('common.name')} value={row.name} onChange={(e) => setCustomerRows((rows) => rows.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))} />
                  <TextInput label={t('common.phone')} value={row.phone} onChange={(e) => setCustomerRows((rows) => rows.map((r, idx) => idx === i ? { ...r, phone: e.target.value } : r))} />
                </div>
              ))
            ) : (
              <>
                <p className="mutedText">{t('onboarding.steps.customers.csvHint')}</p>
                <textarea
                  className={styles.csvArea}
                  rows={6}
                  placeholder={'Jane Doe, 9876543210\nJohn Smith, 9123456780'}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                />
              </>
            )}
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button onClick={handleCustomersContinue} disabled={saving}>{t('onboarding.continue')}</Button>
              <Button variant="secondary" onClick={() => goToStep(4)} disabled={saving}>{t('onboarding.skipStep')}</Button>
            </div>
          </>
        )}

        {STEP_KEYS[stepIndex] === 'staff' && (
          <>
            <h2>{t('onboarding.steps.staff.title')}</h2>
            <p className="mutedText">{t('onboarding.steps.staff.hint')}</p>
            {addedStaffCount > 0 && <p className="mutedText">{t('onboarding.steps.staff.added', { count: addedStaffCount })}</p>}
            <div className="formGrid" style={{ marginTop: 16 }}>
              <TextInput label={t('common.name')} value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} />
              <TextInput label={t('common.phone')} value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} />
              <TextInput label={t('staff.modal.password')} type="password" value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} />
            </div>
            {error && <p className="errorText">{error}</p>}
            <div className="formActions">
              <Button onClick={handleStaffContinue} disabled={saving}>{t('onboarding.finish')}</Button>
              <Button variant="secondary" onClick={skipSetup} disabled={saving}>{t('onboarding.skipStep')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
