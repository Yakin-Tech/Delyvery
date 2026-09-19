import { useTranslation } from 'react-i18next';
import styles from './Table.module.css';

// Renders both a normal table and a stacked-card layout, and lets CSS pick
// one per viewport width (see the max-width breakpoint in Table.module.css)
// instead of a resize-listener — a table's columns just don't fit a phone
// width thumb-friendly, but every existing caller's `columns` config (with
// its `render`) already has everything needed to lay a row out as a card too,
// so no call site needs to change. Pass `hideInCard` on a column (e.g. a
// redundant "actions" column already reachable by tapping the card) to leave
// it out of the card view.
export default function Table({ columns, rows, rowKey, emptyMessage }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) {
    return <p className="mutedText">{emptyMessage || t('common.noRecords')}</p>;
  }

  const cardColumns = columns.filter((col) => !col.hideInCard);

  return (
    <>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.cardList}>
        {rows.map((row) => (
          <div key={rowKey(row)} className={styles.rowCard}>
            {cardColumns.map((col) => (
              <div key={col.key} className={styles.cardField}>
                <span className={styles.cardLabel}>{col.header}</span>
                <span className={styles.cardValue}>{col.render ? col.render(row) : row[col.key]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
