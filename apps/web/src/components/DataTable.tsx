import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Column definition
// ---------------------------------------------------------------------------
export interface Column<T> {
  /** Unique key for the column */
  key: string;
  /** Header label */
  header: string;
  /** Render function for the cell content */
  render: (row: T, index: number) => React.ReactNode;
  /** Optional header alignment */
  align?: 'left' | 'center' | 'right';
  /** Optional className for the td */
  className?: string;
}

// ---------------------------------------------------------------------------
// Pagination state
// ---------------------------------------------------------------------------
export interface PaginationState {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Unique key extractor, defaults to index */
  rowKey?: (row: T, index: number) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function DataTable<T>({
  columns,
  data,
  pagination,
  onPageChange,
  isLoading = false,
  emptyMessage = 'No data found.',
  rowKey,
}: DataTableProps<T>) {
  // Skeleton rows when loading
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-left font-medium text-muted-foreground',
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-b last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-left font-medium text-muted-foreground',
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <p className="text-sm">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  // Determine visible page numbers (max 5 around current)
  const pageNumbers: number[] = [];
  if (pagination) {
    const { page, totalPages } = pagination;
    let start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) {
      pageNumbers.push(i);
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left font-medium text-muted-foreground',
                    col.align === 'center' && 'text-center',
                    col.align === 'right' && 'text-right',
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={rowKey ? rowKey(row, idx) : idx}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3',
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                      col.className,
                    )}
                  >
                    {col.render(row, idx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Showing{' '}
            {(pagination.page - 1) * pagination.pageSize + 1}
            {' - '}
            {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)}
            {' of '}
            {pagination.totalItems} items
          </p>

          <div className="flex items-center gap-1">
            {/* First */}
            <button
              onClick={() => onPageChange(1)}
              disabled={pagination.page === 1}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>

            {/* Previous */}
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Page numbers */}
            {pageNumbers.map((num) => (
              <button
                key={num}
                onClick={() => onPageChange(num)}
                className={cn(
                  'min-w-[32px] rounded-md px-2 py-1 text-sm font-medium transition-colors',
                  num === pagination.page
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {num}
              </button>
            ))}

            {/* Next */}
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Last */}
            <button
              onClick={() => onPageChange(pagination.totalPages)}
              disabled={pagination.page === pagination.totalPages}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
