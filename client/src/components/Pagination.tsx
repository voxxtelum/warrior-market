interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <div className="pagination">
      <button type="button" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
        Prev
      </button>
      <span className="pagination-label">
        Page {page + 1} of {pageCount}
      </span>
      <button type="button" disabled={page >= pageCount - 1} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
