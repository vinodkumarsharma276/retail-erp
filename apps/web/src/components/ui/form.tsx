import * as React from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

/**
 * Form layout primitives.
 *
 * The forms across this app had each grown their own grid — one page used
 * `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`, another `lg:grid-cols-3`,
 * and fields picked column spans ad hoc. The result was that a short field
 * like "GST %" got the same width as "Model", and rows never lined up.
 *
 * `FormGrid` is a plain 12-column grid and `Field` takes a `span`, so a field's
 * width is stated once, in units, next to the field itself.
 */

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export interface FormSectionProps extends React.HTMLAttributes<HTMLElement> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned controls in the section header (e.g. a Remove button). */
  actions?: React.ReactNode;
  /** Renders without the card chrome — for sections nested inside a card. */
  bare?: boolean;
}

export function FormSection({
  title,
  description,
  actions,
  bare = false,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <section
      className={cn(
        !bare && 'rounded-lg border border-border bg-card shadow-sm',
        className,
      )}
      {...props}
    >
      {(title || actions) && (
        <div
          className={cn(
            'flex items-start justify-between gap-3',
            bare ? 'mb-3' : 'border-b border-border px-4 py-3',
          )}
        >
          <div className="min-w-0">
            {title && <h3 className="text-subtitle">{title}</h3>}
            {description && <p className="mt-0.5 text-caption">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(!bare && 'p-4')}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function FormGrid({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-12', className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

/**
 * Tailwind needs the full class name at build time, so spans are a lookup
 * rather than an interpolated `sm:col-span-${n}`.
 */
const spanClasses: Record<number, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  5: 'sm:col-span-5',
  6: 'sm:col-span-6',
  7: 'sm:col-span-7',
  8: 'sm:col-span-8',
  9: 'sm:col-span-9',
  10: 'sm:col-span-10',
  11: 'sm:col-span-11',
  12: 'sm:col-span-12',
};

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** Columns out of 12 at `sm` and up. Full width below that. */
  span?: number;
  /** Guidance shown under the control. Suppressed while an error is showing. */
  hint?: React.ReactNode;
  error?: string | false | null;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  required,
  span = 3,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn(spanClasses[span] ?? spanClasses[3], className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {/* One slot for both, so a field never shows advice and an error at
          once — the error is what the user needs to act on. */}
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
