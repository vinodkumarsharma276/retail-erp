import { useEffect, useRef, useState } from 'react';
import { Columns3, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { useEscapeKey } from '../hooks/useEscapeKey';

export interface ColumnPickerItem {
  key: string;
  label: string;
  visible: boolean;
  /** Columns the table cannot do without, shown ticked and fixed. */
  locked?: boolean;
}

interface ColumnPickerProps {
  items: ColumnPickerItem[];
  onToggle: (key: string, visible: boolean) => void;
  onReset: () => void;
  /** True when anything has been hidden or dragged, so Reset is worth offering. */
  customised: boolean;
}

/**
 * Choosing which columns a table shows.
 *
 * Stays open while boxes are ticked — picking columns is a few decisions in
 * a row, and a menu that shut after each one would make it four trips.
 */
export function ColumnPicker({ items, onToggle, onReset, customised }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEscapeKey(open, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const shown = items.filter((i) => i.visible).length;
  const hidden = items.length - shown;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
          'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
        )}
      >
        <Columns3 className="h-3.5 w-3.5" />
        Columns
        {hidden > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
            {shown}/{items.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="group"
          aria-label="Show or hide columns"
          className={cn(
            'absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-lg border bg-popover shadow-lg',
          )}
        >
          <div className="max-h-[320px] overflow-y-auto py-1">
            {items.map((item) => (
              <label
                key={item.key}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-muted',
                  item.locked && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                )}
                title={item.locked ? 'This column cannot be hidden' : undefined}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0"
                  checked={item.visible}
                  disabled={item.locked}
                  onChange={(e) => onToggle(item.key, e.target.checked)}
                />
                <span className="min-w-0 truncate">{item.label}</span>
              </label>
            ))}
          </div>

          {customised && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset columns and widths
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
