interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  limit?: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, limit = 10, onPageChange }: PaginationProps) {
  const hasPage = totalPages > 0 && Number.isSafeInteger(page) && page >= 1 && page <= totalPages;
  const first = (page - 1) * limit + 1;
  const showRange = hasPage && total !== undefined && first <= total;

  return (
    <nav aria-label="Pagination" className="list-pagination">
      <button type="button" className="btn" aria-label="Previous page" disabled={!hasPage || page <= 1}
        onClick={() => onPageChange(page - 1)}>Previous</button>
      <span aria-live="polite" aria-atomic="true">
        {hasPage && <span>Page {page} of {totalPages}</span>}
        {showRange && <span>Results {first}–{Math.min(page * limit, total)} of {total}</span>}
        {totalPages === 0 && <span>No results</span>}
      </span>
      <button type="button" className="btn" aria-label="Next page" disabled={!hasPage || page >= totalPages}
        onClick={() => onPageChange(page + 1)}>Next</button>
    </nav>
  );
}
