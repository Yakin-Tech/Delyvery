import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listCustomers, reorderCustomers } from '../../api/customers.api';
import { listStaff } from '../../api/staff.api';
import Button from '../../components/common/Button';
import Select from '../../components/common/Select';
import Spinner from '../../components/common/Spinner';
import styles from './RouteReorderPage.module.css';

function sortByRoute(customers) {
  return [...customers].sort((a, b) => {
    if (a.route_sequence == null && b.route_sequence == null) return a.name.localeCompare(b.name);
    if (a.route_sequence == null) return 1;
    if (b.route_sequence == null) return -1;
    return a.route_sequence - b.route_sequence;
  });
}

export default function RouteReorderPage() {
  const { t } = useTranslation();
  const [staffOptions, setStaffOptions] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);

  useEffect(() => { listStaff({ page_size: 100 }).then((r) => setStaffOptions(r.data)); }, []);

  async function load(currentStaffId) {
    setLoading(true);
    try {
      const result = await listCustomers({ assigned_staff_id: currentStaffId || undefined, page_size: 200, status: 'active' });
      setCustomers(sortByRoute(result.data));
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(staffId); }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDragStart(index) {
    setDragIndex(index);
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setCustomers((list) => {
      const next = [...list];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(index);
    setDirty(true);
  }

  function handleDragEnd() {
    setDragIndex(null);
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= customers.length) return;
    setCustomers((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await reorderCustomers(customers.map((c) => c.id));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('routes.title')}</h1>
        <Button onClick={handleSave} disabled={!dirty || saving}>{saving ? t('common.saving') : t('routes.saveOrder')}</Button>
      </div>

      <p className="mutedText">{t('routes.hint')}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <Select label={t('deliveries.filters.staff')} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">{t('deliveries.filters.allStaff')}</option>
          {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      <div className="card">
        {loading ? <Spinner /> : (
          <ul className={styles.list}>
            {customers.map((c, index) => (
              <li
                key={c.id}
                className={styles.row}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                <span className={styles.handle}>⠿</span>
                <span className={styles.index}>{index + 1}</span>
                <div className={styles.info}>
                  <div className={styles.name}>{c.name}</div>
                  <div className="mutedText">{c.phone || ''}</div>
                </div>
                <div className={styles.moveButtons}>
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('routes.moveUp')}>▲</button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === customers.length - 1} aria-label={t('routes.moveDown')}>▼</button>
                </div>
              </li>
            ))}
            {customers.length === 0 && <p className="mutedText">{t('routes.empty')}</p>}
          </ul>
        )}
      </div>
    </div>
  );
}
