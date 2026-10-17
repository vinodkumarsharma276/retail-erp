import { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Completeness } from '../lib/distributor-completeness';

/**
 * A red mark on a row whose record is missing details, with the list of what
 * is missing on hover or focus.
 *
 * Suppliers brought in from a Tally purchase register have no bank details and
 * often no phone number, because the register does not carry them. The mark
 * says so where it is noticed — on the row — rather than only once the
 * supplier is opened.
 */
export function IncompleteDetailsBadge({
  completeness,
  className,
}: {
  completeness: Completeness;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (completeness.isComplete) return null;

  const { missing, importantMissing } = completeness;
  const label = `${missing.length} detail${missing.length === 1 ? '' : 's'} missing`;

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          // The row itself usually navigates; the mark is only a hint.
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
          importantMissing.length > 0
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-warning hover:bg-warning/10',
        )}
      >
        <AlertCircle className="h-4 w-4" />
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-60 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left shadow-lg"
        >
          <span className="block text-xs font-semibold">{label}</span>
          {completeness.fromImport && (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Created from an imported sheet, which does not carry these.
            </span>
          )}
          <span className="mt-2 block space-y-1.5">
            {completeness.byGroup.map((entry) => (
              <span key={entry.group} className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {entry.group}
                </span>
                <span className="block text-xs">
                  {entry.fields.map((field) => field.label).join(', ')}
                </span>
              </span>
            ))}
          </span>
          <span className="mt-2 block text-[11px] text-muted-foreground">
            Open the supplier and use the Missing details tab to fill them in.
          </span>
        </span>
      )}
    </span>
  );
}
