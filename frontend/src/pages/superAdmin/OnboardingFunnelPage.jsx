import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchOnboardingFunnel } from '../../api/superAdmin.api';
import Spinner from '../../components/common/Spinner';
import styles from './OnboardingFunnelPage.module.css';

export default function OnboardingFunnelPage() {
  const { t } = useTranslation();
  const [stages, setStages] = useState(null);

  useEffect(() => { fetchOnboardingFunnel().then((d) => setStages(d.stages)); }, []);

  if (!stages) return <Spinner />;

  const maxCount = stages[0]?.count || 1;

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{t('superAdmin.funnel.title')}</h1>
      </div>
      <p className="mutedText" style={{ marginBottom: 24 }}>{t('superAdmin.funnel.hint')}</p>

      <div className="card">
        {stages.map((s, i) => {
          const pct = maxCount > 0 ? Math.round((s.count / maxCount) * 100) : 0;
          const dropoff = i > 0 ? stages[i - 1].count - s.count : 0;
          return (
            <div key={s.stage} className={styles.stageRow}>
              <div className={styles.stageLabel}>
                <span>{t(`superAdmin.funnel.stages.${s.stage}`)}</span>
                <span>
                  <strong>{s.count}</strong>
                  {i > 0 && dropoff > 0 && <span className="mutedText"> ({t('superAdmin.funnel.dropoff', { count: dropoff })})</span>}
                </span>
              </div>
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
