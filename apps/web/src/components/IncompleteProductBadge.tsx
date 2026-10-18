import { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * A mark on a stock row whose units are still missing details, with what is
 * missing on hover or focus.
 *
 * Units brought in from a purchase sheet arrive thin: the sheet says what was
 * bought and the price paid, and often not even a model number. That is not a
 * reason to refuse them — they exist and they were paid for — so they come in
 * and the gaps show here, where somebody will see them.
 */
export function IncompleteProductBadge({
  counts,
  quantity,
  className,
}: {
  counts: { model: number; price: number; specs: number } | undefined;
  quantity: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!counts) return null;
  // Red is reserved for what stops the unit being used. A price or a
  // specification still to be filled in is a job, not a fault, and after an
  // import that is every unit — marking them all as faults says nothing.
  const gaps = [
    { n: counts.model, label: 'no model number', important: true },
    { n: counts.price, label: 'no selling price yet', important: false },
    { n: counts.specs, label: 'no specifications yet', important: false },
  ].filter((gap) => gap.n > 0);
  if (gaps.length === 0) return null;

  const important = gaps.some((gap) => gap.important);
  const of = (n: number) => (n === quantity ? 'all' : `${n} of ${quantity}`);

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${gaps.length} detail${gaps.length === 1 ? '' : 's'} still to fill in`}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          // The row expands on click; the mark is only a hint.
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
          important ? 'text-destructive hover:bg-destructive/10' : 'text-warning hover:bg-warning/10',
        )}
      >
        <AlertCircle className="h-4 w-4" />
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left shadow-lg"
        >
          <span className="block text-xs font-semibold">
            {important ? 'Needs attention' : 'Still to fill in'}
          </span>
          <span className="mt-1.5 block space-y-1">
            {gaps.map((gap) => (
              <span key={gap.label} className="block text-xs">
                <span className={cn('font-medium', gap.important ? 'text-destructive' : 'text-warning')}>
                  {of(gap.n)}
                </span>{' '}
                {gap.label}
              </span>
            ))}
          </span>
          <span className="mt-2 block text-[11px] text-muted-foreground">
            Open the row and edit a unit to fill these in.
          </span>
        </span>
      )}
    </span>
  );
}
