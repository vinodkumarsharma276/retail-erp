import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { ColumnPicker } from './ColumnPicker';
import { useTablePreferences } from '../hooks/useTablePreferences';

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
  /** Hide this column in mobile card layout */
  hideOnMobile?: boolean;
  /** Lower numbers appear earlier in mobile card layout */
  mobilePriority?: number;
  /** Optional label override for mobile card layout */
  mobileLabel?: string;
  /** When true, header becomes a clickable sort toggle. */
  sortable?: boolean;
  /** Returns the value to sort by. Falls back to `(row as any)[key]`. */
  sortAccessor?: (row: T) => string | number | Date | null | undefined;
  /**
   * Keep this column on screen: it is what the row is identified by, or the
   * only way to act on it. Shown ticked and fixed in the column picker.
   */
  alwaysVisible?: boolean;
  /** Stop this column being dragged wider or narrower. */
  resizable?: boolean;
}

export type SortDir = 'asc' | 'desc';
interface SortState {
  key: string;
  dir: SortDir;
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
  /** Optional row click handler. When set, rows show a pointer cursor. */
  onRowClick?: (row: T, index: number) => void;
  /** Initial sort to apply to the table. Column must be `sortable`. */
  defaultSort?: { key: string; dir: SortDir };
  /**
   * Tick rows off to act on several at once. Needs `rowKey`, since the
   * selection is kept by key and has to survive sorting and paging.
   */
  selection?: {
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    /** Rows that cannot be picked, with the reason, shown on hover. */
    disabledReason?: (row: T) => string | null;
  };
  /**
   * Hand sorting to whoever supplies the rows.
   *
   * Sorting in here can only ever order the page it was given, which on a
   * paginated list is the wrong answer: "most owed first" has to consider
   * every row, not the twenty on screen. When this is set the headers
   * report the click instead of reordering anything themselves.
   */
  serverSort?: {
    key: string | null;
    dir: SortDir;
    onChange: (key: string, dir: SortDir) => void;
  };
  /**
   * Names this table so the viewer's column choices and dragged widths can
   * be remembered between visits. Without it the table behaves as it always
   * did: every column, no picker, no drag handles.
   */
  tableId?: string;
}

/** Narrower than this and a column is unreadable rather than compact. */
const MIN_COLUMN_WIDTH = 60;

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
  onRowClick,
  defaultSort,
  selection,
  serverSort,
  tableId,
}: DataTableProps<T>) {
  // Only on the desktop table: a row of tickboxes is no way to work on a phone.
  const picking = Boolean(selection && rowKey);
  const keyOf = (row: T, idx: number) => (rowKey ? rowKey(row, idx) : String(idx));

  // ------ What this viewer wants to see, and how wide ------
  const { prefs, toggleColumn, setWidth, reset } = useTablePreferences(tableId);
  const tableRef = useRef<HTMLTableElement>(null);

  const canCustomise = Boolean(tableId);
  const hidden = useMemo(() => new Set(canCustomise ? prefs.hidden : []), [canCustomise, prefs.hidden]);

  /** Columns actually rendered, here and in the phone cards alike. */
  const visibleColumns = useMemo(
    () => columns.filter((col) => col.alwaysVisible || !hidden.has(col.key)),
    [columns, hidden],
  );

  const mobileColumns = visibleColumns
    .filter((column) => !column.hideOnMobile)
    .sort((a, b) => (a.mobilePriority ?? 50) - (b.mobilePriority ?? 50));
  const [mobileTitleColumn, ...mobileDetailColumns] = mobileColumns;

  // ------ Sorting (client-side over current data slice) ------
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);

  const sortedData = useMemo(() => {
    // Already ordered by whoever fetched it.
    if (serverSort) return data;
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sortable) return data;
    const accessor =
      col.sortAccessor ?? ((row: T) => (row as Record<string, unknown>)[sort.key] as string | number | Date | null | undefined);
    const factor = sort.dir === 'asc' ? 1 : -1;
    const arr = [...data];
    arr.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last
      if (bv == null) return -1;
      if (av instanceof Date || bv instanceof Date) {
        const an = av instanceof Date ? av.getTime() : new Date(av as string).getTime();
        const bn = bv instanceof Date ? bv.getTime() : new Date(bv as string).getTime();
        return (an - bn) * factor;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * factor;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return -1 * factor;
      if (as > bs) return 1 * factor;
      return 0;
    });
    return arr;
  }, [data, sort, columns, serverSort]);

  /** Rows on this page the user may actually pick. */
  const pickableKeys = useMemo(
    () =>
      picking
        ? sortedData
            .map((row, idx) => ({ key: keyOf(row, idx), why: selection!.disabledReason?.(row) ?? null }))
            .filter((r) => !r.why)
            .map((r) => r.key)
        : [],
    [picking, sortedData, selection],
  );

  const toggleSort = (key: string) => {
    if (serverSort) {
      // A fresh column starts on the order that column is usually read in:
      // names A to Z, amounts and counts biggest first.
      const col = columns.find((c) => c.key === key);
      const firstDir: SortDir = col?.align === 'right' ? 'desc' : 'asc';
      const next: SortDir =
        serverSort.key === key ? (serverSort.dir === 'asc' ? 'desc' : 'asc') : firstDir;
      serverSort.onChange(key, next);
      return;
    }
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click clears
    });
  };

  /** What the header arrows should show. */
  const activeSort = serverSort ? { key: serverSort.key, dir: serverSort.dir } : sort;

  // ------ Dragging a column wider or narrower ------
  /** The drag in progress, shown live before it is written down. */
  const [dragging, setDragging] = useState<{ key: string; width: number } | null>(null);

  const widthFor = (key: string) =>
    dragging?.key === key ? dragging.width : prefs.widths[key];

  /**
   * Widths only hold under `table-layout: fixed`; on auto the browser sizes
   * to content and ignores them. Switching layout mid-table would jump, so
   * every column's current width is written down on the first drag and the
   * table changes over already measured.
   */
  const anyWidthSet = Object.keys(prefs.widths).length > 0 || dragging != null;

  const startResize = (event: React.PointerEvent<HTMLSpanElement>, key: string) => {
    event.preventDefault();
    // The handle sits in the header; the header sorts. Not this click.
    event.stopPropagation();

    const th = (event.currentTarget.closest('th') as HTMLTableCellElement | null);
    if (!th) return;
    const startX = event.clientX;
    const startWidth = th.getBoundingClientRect().width;

    // Pin the others at what they measure now, so only this one moves.
    if (Object.keys(prefs.widths).length === 0 && tableRef.current) {
      const measured: Record<string, number> = {};
      for (const cell of tableRef.current.querySelectorAll<HTMLTableCellElement>('thead th[data-col]')) {
        const colKey = cell.dataset.col;
        if (colKey) measured[colKey] = cell.getBoundingClientRect().width;
      }
      for (const [k, w] of Object.entries(measured)) if (k !== key) setWidth(k, w);
    }

    // No pointer capture: the move and up listeners are on the window, which
    // already follows the pointer off the handle, and capture throws on a
    // synthetic event — taking the whole drag down with it.
    setDragging({ key, width: startWidth });

    const onMove = (move: PointerEvent) => {
      setDragging({ key, width: Math.max(MIN_COLUMN_WIDTH, startWidth + (move.clientX - startX)) });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setWidth(key, Math.max(MIN_COLUMN_WIDTH, startWidth + (up.clientX - startX)));
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const columnPickerItems = columns.map((col) => ({
    key: col.key,
    label: col.header || col.key,
    visible: col.alwaysVisible || !hidden.has(col.key),
    locked: col.alwaysVisible,
  }));
  const customised = prefs.hidden.length > 0 || Object.keys(prefs.widths).length > 0;

  /**
   * Offered above the table whether or not there are rows: a filter that
   * matches nothing must not be the thing that traps a hidden column.
   */
  const toolbar = canCustomise ? (
    <div className="hidden items-center justify-end border-b border-border/60 px-3 py-1.5 md:flex">
      <ColumnPicker
        items={columnPickerItems}
        onToggle={toggleColumn}
        onReset={reset}
        customised={customised}
      />
    </div>
  ) : null;

  // Skeleton rows when loading
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {toolbar}
        <div className="divide-y md:hidden">
          {Array.from({ length: 4 }).map((_, rowIdx) => (
            <div key={rowIdx} className="p-3">
              <div className="mb-3 h-4 w-2/3 skeleton rounded" />
              <div className="space-y-2">
                <div className="h-3 w-full skeleton rounded" />
                <div className="h-3 w-3/4 skeleton rounded" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'h-9 whitespace-nowrap px-3 text-left align-middle text-overline',
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="stagger">
              {Array.from({ length: 5 }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-b last:border-0">
                  {visibleColumns.map((col) => (
                    <td key={col.key} className="px-3 py-2">
                      <div className="h-4 w-3/4 skeleton rounded" />
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
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {toolbar}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'h-9 whitespace-nowrap px-3 text-left align-middle text-overline',
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
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="stagger divide-y md:hidden">
        {sortedData.map((row, idx) => (
          <div
            key={rowKey ? rowKey(row, idx) : idx}
            onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onRowClick(row, idx);
              }
            } : undefined}
            className={cn(
              'block w-full p-3 text-left transition-colors',
              onRowClick ? 'cursor-pointer hover:bg-subtle' : 'cursor-default',
            )}
          >
            {mobileTitleColumn && (
              <div className="mb-2 flex items-start justify-between gap-3 text-sm font-semibold">
                <span className="min-w-0 flex-1 break-words">{mobileTitleColumn.render(row, idx)}</span>
              </div>
            )}
            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              {mobileDetailColumns.slice(0, 6).map((col) => (
                <div key={col.key} className="min-w-0">
                  <dt className="text-muted-foreground">{col.mobileLabel ?? col.header}</dt>
                  <dd className="mt-0.5 break-words text-foreground">{col.render(row, idx)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {toolbar}

      <div className="hidden overflow-x-auto md:block">
        <table
          ref={tableRef}
          className={cn('w-full text-sm', anyWidthSet && 'table-fixed')}
        >
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {picking && (
                <th className="h-9 w-10 px-3 text-left align-middle">
                  <input
                    type="checkbox"
                    aria-label="Select every row on this page"
                    className="h-4 w-4"
                    checked={pickableKeys.length > 0 && pickableKeys.every((k) => selection!.selected.has(k))}
                    ref={(el) => {
                      if (el) {
                        const picked = pickableKeys.filter((k) => selection!.selected.has(k)).length;
                        el.indeterminate = picked > 0 && picked < pickableKeys.length;
                      }
                    }}
                    onChange={(event) => {
                      const next = new Set(selection!.selected);
                      for (const k of pickableKeys) {
                        if (event.target.checked) next.add(k);
                        else next.delete(k);
                      }
                      selection!.onChange(next);
                    }}
                  />
                </th>
              )}
              {visibleColumns.map((col) => {
                const isActive = activeSort?.key === col.key;
                const Icon = !isActive ? ChevronsUpDown : activeSort?.dir === 'asc' ? ChevronUp : ChevronDown;
                const width = widthFor(col.key);
                const canResize = canCustomise && col.resizable !== false;
                return (
                  <th
                    key={col.key}
                    data-col={col.key}
                    style={width ? { width, minWidth: width, maxWidth: width } : undefined}
                    className={cn(
                      'group/th relative h-9 px-3 text-left align-middle text-overline',
                      // Fixed layout has to be allowed to clip, or a long
                      // header keeps the column wider than it was dragged.
                      anyWidthSet ? 'truncate' : 'whitespace-nowrap',
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                    )}
                  >
                    {canResize && (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${col.header || col.key} column`}
                        onPointerDown={(e) => startResize(e, col.key)}
                        // Back to sizing itself to its contents.
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setWidth(col.key, null);
                        }}
                        className={cn(
                          'absolute right-0 top-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize select-none',
                          'after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2',
                          'after:bg-border after:opacity-0 after:transition-opacity',
                          'hover:after:opacity-100 group-hover/th:after:opacity-60',
                          dragging?.key === col.key && 'after:bg-primary after:opacity-100',
                        )}
                      />
                    )}
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'group inline-flex max-w-full items-center gap-1 select-none hover:text-foreground transition-colors',
                          col.align === 'right' && 'flex-row-reverse',
                          isActive && 'text-foreground',
                        )}
                      >
                        <span className="truncate">{col.header}</span>
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5 transition-opacity',
                            isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-80',
                          )}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="stagger">
            {sortedData.map((row, idx) => (
              <tr
                key={keyOf(row, idx)}
                onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
                className={cn(
                  'border-b border-border/60 transition-colors last:border-0 hover:bg-subtle',
                  onRowClick && 'cursor-pointer',
                  picking && selection!.selected.has(keyOf(row, idx)) && 'bg-primary/5',
                )}
              >
                {picking && (() => {
                  const key = keyOf(row, idx);
                  const why = selection!.disabledReason?.(row) ?? null;
                  return (
                    <td
                      // The reason sits on the cell, not the box: a disabled
                      // input fires no hover, so a tooltip on it never shows.
                      className={cn('w-10 px-3 py-2 align-middle', why && 'cursor-not-allowed')}
                      title={why ?? undefined}
                      // The row itself may open the record; ticking it must not.
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={why ? `Cannot select this row: ${why}` : 'Select this row'}
                        checked={selection!.selected.has(key)}
                        disabled={Boolean(why)}
                        onChange={(event) => {
                          const next = new Set(selection!.selected);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          selection!.onChange(next);
                        }}
                      />
                    </td>
                  );
                })()}
                {visibleColumns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2 align-middle',
                      // Under fixed layout a cell has to clip, or its
                      // contents hold the column open against the drag.
                      anyWidthSet && 'truncate',
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
        <div className="flex flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
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
