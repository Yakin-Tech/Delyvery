import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getOwnOrganization, updateOwnOrganization } from '../../api/organization.api';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/common/Button';
import TextInput from '../../components/common/TextInput';
import Select from '../../components/common/Select';
import Spinner from '../../components/common/Spinner';
import AccountSettingsForm from '../../components/common/AccountSettingsForm';
import { businessTypeLabel, UNIT_VALUES, DELIVERY_MODE_PRESETS } from '../../utils/businessTypes';

const KNOWN_UNIT_PRESETS = UNIT_VALUES.filter((v) => v !== 'other');

export default function SettingsPage() {
  const { t } = useTranslation();
  const { updateOrganization } = useAuth();
  const [organization, setOrganization] = useState(null);
  const [form, setForm] = useState(null);
  const [customModeInput, setCustomModeInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getOwnOrganization().then((org) => {
      setOrganization(org);
      const isKnownUnit = KNOWN_UNIT_PRESETS.includes(org.unit_of_measure);
      setForm({
        unit_of_measure: isKnownUnit ? org.unit_of_measure : 'other',
        unit_of_measure_other: isKnownUnit ? '' : (org.unit_of_measure || ''),
        default_price_per_unit: org.default_price_per_unit ?? '',
        address: org.address || '',
        phone: (org.phone_numbers && org.phone_numbers[0]) || '',
        logo_url: org.logo_url || '',
        delivery_modes: org.delivery_modes || [],
        staff_sees_all_customers: org.staff_sees_all_customers,
        staff_can_add_customers: org.staff_can_add_customers,
        payment_allocation_mode: org.payment_allocation_mode || 'fifo',
        products_enabled: org.products_enabled,
        routes_enabled: org.routes_enabled,
        stock_enabled: org.stock_enabled,
      });
    }).finally(() => setLoading(false));
  }, []);

  function toggleMode(mode) {
    setForm((f) => {
      const has = f.delivery_modes.includes(mode);
      return { ...f, delivery_modes: has ? f.delivery_modes.filter((m) => m !== mode) : [...f.delivery_modes, mode] };
    });
  }

  function addCustomMode() {
    const value = customModeInput.trim();
    if (!value) return;
    setForm((f) => (f.delivery_modes.includes(value) ? f : { ...f, delivery_modes: [...f.delivery_modes, value] }));
    setCustomModeInput('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const unit_of_measure = form.unit_of_measure === 'other' ? (form.unit_of_measure_other || 'other') : form.unit_of_measure;
      const updated = await updateOwnOrganization({
        unit_of_measure,
        default_price_per_unit: form.default_price_per_unit,
        address: form.address,
        phone_numbers: form.phone ? [form.phone] : [],
        logo_url: form.logo_url || null,
        delivery_modes: form.delivery_modes,
        staff_sees_all_customers: form.staff_sees_all_customers,
        staff_can_add_customers: form.staff_can_add_customers,
        payment_allocation_mode: form.payment_allocation_mode,
        products_enabled: form.products_enabled,
        routes_enabled: form.routes_enabled,
        stock_enabled: form.stock_enabled,
      });
      setOrganization(updated);
      updateOrganization(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !organization || !form) return <Spinner />;

  // Route ordering and the per-staff customer switches only exist for the live
  // route_staff model; a vehicle_eod org has no use for them.
  const vehicleOrg = organization.delivery_model === 'vehicle_eod';

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="mutedText">{t('settings.identityLabel')}</div>
        <p style={{ marginTop: 8 }}>
          <strong>{organization.name}</strong> &middot; {businessTypeLabel(organization.business_type, t)}
        </p>
        <div className="mutedText" style={{ marginTop: 16 }}>{t('settings.deliveryModelLabel')}</div>
        <p style={{ marginTop: 8, marginBottom: 4 }}>
          <strong>{vehicleOrg ? t('settings.deliveryModelVehicleEod') : t('settings.deliveryModelRouteStaff')}</strong>
        </p>
        <p className="mutedText" style={{ marginBottom: 0 }}>{t('settings.deliveryModelHint')}</p>
      </div>

      <form className="card" onSubmit={handleSubmit}>
        <h2>{t('settings.operations')}</h2>
        <div className="formGrid">
          <Select
            label={t('settings.unitOfMeasure')}
            value={form.unit_of_measure}
            onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })}
          >
            {UNIT_VALUES.map((v) => <option key={v} value={v}>{t(`units.${v}`)}</option>)}
          </Select>
          {form.unit_of_measure === 'other' && (
            <TextInput
              label={t('settings.unitPlaceholder')}
              required
              value={form.unit_of_measure_other}
              onChange={(e) => setForm({ ...form, unit_of_measure_other: e.target.value })}
            />
          )}
          <TextInput
            label={t('settings.defaultPrice')}
            type="number" step="0.01" min="0"
            value={form.default_price_per_unit}
            onChange={(e) => setForm({ ...form, default_price_per_unit: e.target.value })}
          />
          <TextInput label={t('settings.phoneNumber')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextInput label={t('settings.logoUrl')} value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
        </div>
        <TextInput label={t('common.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ marginTop: 16 }} />

        <h2 style={{ marginTop: 24 }}>{t('settings.deliveryModesLabel')}</h2>
        <p className="mutedText" style={{ marginTop: -8, marginBottom: 12 }}>{t('settings.deliveryModesHint')}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {DELIVERY_MODE_PRESETS.map((mode) => {
            const active = form.delivery_modes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                onClick={() => toggleMode(mode)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 100,
                  border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                  color: active ? 'var(--color-accent-contrast)' : 'var(--color-text)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {t(`deliveryModes.${mode}`)}
              </button>
            );
          })}
          {form.delivery_modes.filter((m) => !DELIVERY_MODE_PRESETS.includes(m)).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => toggleMode(mode)}
              style={{ padding: '8px 16px', borderRadius: 100, border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontSize: 13, fontWeight: 600 }}
            >
              {mode} &times;
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput
            placeholder={t('settings.customModePlaceholder')}
            value={customModeInput}
            onChange={(e) => setCustomModeInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button type="button" variant="secondary" onClick={addCustomMode}>{t('settings.addMode')}</Button>
        </div>

        <h2 style={{ marginTop: 24 }}>{t('settings.paymentAllocation')}</h2>
        <p className="mutedText" style={{ marginTop: -8, marginBottom: 12 }}>{t('settings.paymentAllocationHint')}</p>
        <Select
          value={form.payment_allocation_mode}
          onChange={(e) => setForm({ ...form, payment_allocation_mode: e.target.value })}
          style={{ marginBottom: 12 }}
        >
          <option value="fifo">{t('settings.paymentAllocationFifo')}</option>
          <option value="manual">{t('settings.paymentAllocationManual')}</option>
        </Select>

        <h2 style={{ marginTop: 24 }}>{t('settings.modules')}</h2>
        <p className="mutedText" style={{ marginTop: -8, marginBottom: 12 }}>{t('settings.modulesHint')}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={form.products_enabled}
            onChange={(e) => setForm({ ...form, products_enabled: e.target.checked })}
          />
          {t('settings.modulesProducts')}
        </label>
        {!vehicleOrg && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.routes_enabled}
              onChange={(e) => setForm({ ...form, routes_enabled: e.target.checked })}
            />
            {t('settings.modulesRoutes')}
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={form.stock_enabled}
            onChange={(e) => setForm({ ...form, stock_enabled: e.target.checked })}
          />
          {t('settings.modulesStock')}
        </label>

        {!vehicleOrg && (
          <>
            <h2 style={{ marginTop: 24 }}>{t('settings.staffPermissions')}</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={form.staff_sees_all_customers}
                onChange={(e) => setForm({ ...form, staff_sees_all_customers: e.target.checked })}
              />
              {t('settings.staffSeesAll')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={form.staff_can_add_customers}
                onChange={(e) => setForm({ ...form, staff_can_add_customers: e.target.checked })}
              />
              {t('settings.staffCanAdd')}
            </label>
          </>
        )}

        {error && <p className="errorText">{error}</p>}
        {saved && <p style={{ fontWeight: 600 }}>&#10003; {t('common.saved')}</p>}

        <div className="formActions">
          <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('settings.saveSettings')}</Button>
        </div>
      </form>

      <div className="card" style={{ marginTop: 24 }}>
        <AccountSettingsForm />
      </div>
    </div>
  );
}
