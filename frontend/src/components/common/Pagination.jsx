import { useTranslation } from 'react-i18next';
import Dropdown from './Dropdown';
import styles from './Pagination.module.css';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 50, 100];

// onPageSizeChange is optional — pass it (with pageSize) to show a "rows per
// page" selector; a caller that doesn't wire it up just gets the prev/next
// bar as before. The bar itself only hides when there's nothing to page at
// all (no pagination yet, or zero results) — a page-size selector still
// needs to show even when the current page size happens to fit everything
// on one page, so a smaller page size can be picked.
export default function Pagination({ pagination, onPageChange, pageSize, onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS }) {
  const { t } = useTranslation();
  if (!pagination || pagination.total === 0) return null;

  const { page, total_pages, total } = pagination;

  return (
    <div className={styles.wrapper}>
      <span className={styles.summary}>{t('pagination.summary', { total })}</span>
      {onPageSizeChange && (
        <div className={styles.pageSizeLabel}>
          <span>{t('pagination.perPage')}</span>
          <Dropdown
            variant="pill"
            aria-label={t('pagination.perPage')}
            options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(pageSize)}
            onChange={(next) => onPageSizeChange(Number(next))}
          />
        </div>
      )}
      {total_pages > 1 && (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.pageButton}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('pagination.previous')}
          </button>
          <span className={styles.pageIndicator}>{t('pagination.pageOf', { page, totalPages: total_pages })}</span>
          <button
            type="button"
            className={styles.pageButton}
            disabled={page >= total_pages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('pagination.next')}
          </button>
        </div>
      )}
    </div>
  );
}
