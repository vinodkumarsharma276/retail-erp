import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, Printer, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { useEscapeKey } from '../hooks/useEscapeKey';

export type ExportFormat = 'csv' | 'excel' | 'print';
export type ExportScope = 'page' | 'all';

export interface ExportDialogColumn {
  key: string;
  label: string;
  /** Ticked when the dialog opens — what is on screen now. */
  selected: boolean;
}

interface ExportDialogProps {
  title: string;
  columns: ExportDialogColumn[];
  /** How many rows are on screen, and how many there are altogether. */
  pageCount: number;
  totalCount?: number;
  /** Omitted when the screen cannot fetch beyond the current page. */
  canExportAll: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choice: { columns: string[]; scope: ExportScope; format: ExportFormat }) => void;
}

/**
 * Choosing what leaves the screen.
 *
 * Exporting is rarely "all of it": somebody wants three columns of the
 * whole list for a supplier call, or everything on screen to hand over.
 * So the columns and the row scope are asked before the file is built,
 * starting from what is already on screen — the common case is one click.
 */
export function ExportDialog({
  title,
  columns,
  pageCount,
  totalCount,
  canExportAll,
  busy = false,
  onCancel,
  onConfirm,
}: ExportDialogProps) {
  useEscapeKey(true, () => {
    if (!busy) onCancel();
  });

  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.selected).map((c) => c.key)),
  );
  const [scope, setScope] = useState<ExportScope>('page');

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rowsGoing = scope === 'all' ? (totalCount ?? pageCount) : pageCount;
  const ready = picked.size > 0;

  const go = (format: ExportFormat) =>
    onConfirm({ columns: columns.filter((c) => picked.has(c.key)).map((c) => c.key), scope, format });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onCancel} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-popover shadow-lg"
      >
        <header className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 id="export-title" className="text-lg font-semibold">
              Export or print
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{title}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Which rows */}
          <fieldset>
            <legend className="text-sm font-medium">Rows</legend>
            <div className="mt-2 space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="radio"
                  name="export-scope"
                  className="h-3.5 w-3.5"
                  checked={scope === 'page'}
                  onChange={() => setScope('page')}
                />
                This page
                <span className="text-xs text-muted-foreground">({pageCount})</span>
              </label>
              <label
                className={cn(
                  'flex items-center gap-2.5 text-sm',
                  canExportAll ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                )}
                title={canExportAll ? undefined : 'This screen can only export what it has loaded'}
              >
                <input
                  type="radio"
                  name="export-scope"
                  className="h-3.5 w-3.5"
                  checked={scope === 'all'}
                  disabled={!canExportAll}
                  onChange={() => setScope('all')}
                />
                Everything matching the current filters
                {totalCount != null && (
                  <span className="text-xs text-muted-foreground">({totalCount})</span>
                )}
              </label>
            </div>
          </fieldset>

          {/* Which columns */}
          <fieldset className="mt-5">
            <legend className="flex w-full items-baseline justify-between gap-2 text-sm font-medium">
              <span>Columns</span>
              <span className="text-xs font-normal text-muted-foreground">
                {picked.size} of {columns.length}
              </span>
            </legend>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setPicked(new Set(columns.map((c) => c.key)))}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setPicked(new Set())}
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                None
              </button>
            </div>
            <div className="mt-2 grid max-h-[220px] grid-cols-2 gap-x-4 overflow-y-auto rounded-md border p-2">
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0"
                    checked={picked.has(col.key)}
                    onChange={() => toggle(col.key)}
                  />
                  <span className="min-w-0 truncate">{col.label}</span>
                </label>
              ))}
            </div>
            {picked.size === 0 && (
              <p className="mt-2 text-xs text-destructive">Pick at least one column.</p>
            )}
          </fieldset>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
          <span className="text-xs text-muted-foreground">
            {rowsGoing} row{rowsGoing === 1 ? '' : 's'} · {picked.size} column
            {picked.size === 1 ? '' : 's'}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => go('print')} disabled={!ready || busy}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
            <Button variant="outline" onClick={() => go('csv')} disabled={!ready || busy}>
              <FileText className="mr-1.5 h-4 w-4" />
              CSV
            </Button>
            <Button onClick={() => go('excel')} disabled={!ready || busy}>
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              )}
              Excel
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export { Download };
