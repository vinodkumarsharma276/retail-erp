import { useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

/**
 * One toolbar for every list page.
 *
 * The list screens had grown two or three stacked rows of loose controls —
 * Products put its search on a row of its own below four other filters,
 * Installments stacked tabs, then a date range, then quick-range buttons and
 * a total. Each row cost ~56px above the fold on a laptop, and nothing
 * indicated which controls were related.
 *
 * `FilterBar` puts search and the primary filters on one line, tucks the rest
 * behind a disclosure, and surfaces how many filters are active so the user
 * can always tell why a list looks short.
 */
export interface FilterBarProps {
  /** Bound to the search box. Omit both to hide search entirely. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Always-visible filter controls. Wrap each in `<FilterField>`. */
  children?: ReactNode;
  /** Secondary filters, revealed by the "Filters" toggle. */
  advanced?: ReactNode;
  /** Number of non-default filters applied; drives the badge and Clear. */
  activeCount?: number;
  onClear?: () => void;
  /** Right-aligned slot for view toggles or result summaries. */
  trailing?: ReactNode;
  className?: string;
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  children,
  advanced,
  activeCount = 0,
  onClear,
  trailing,
  className,
}: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const hasSearch = onSearchChange !== undefined;

  return (
    <div
      className={cn(
        'mb-4 rounded-lg border border-border bg-card p-3 shadow-xs',
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-2">
        {hasSearch && (
          <div className="min-w-[min(18rem,100%)] flex-1">
            <Input
              value={search ?? ''}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              icon={<Search className="h-3.5 w-3.5" />}
              aria-label={searchPlaceholder}
            />
          </div>
        )}

        {children}

        <div className="ml-auto flex items-end gap-2">
          {trailing}

          {advanced && (
            <Button
              variant={showAdvanced ? 'secondary' : 'outline'}
              onClick={() => setShowAdvanced((v) => !v)}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              aria-expanded={showAdvanced}
            >
              Filters
              {activeCount > 0 && (
                <span className="tabular ml-0.5 rounded bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          )}

          {activeCount > 0 && onClear && (
            <Button
              variant="ghost"
              onClick={onClear}
              icon={<X className="h-3.5 w-3.5" />}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {advanced && showAdvanced && (
        <div className="animate-fade-in-down mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          {advanced}
        </div>
      )}
    </div>
  );
}

/**
 * Labelled control wrapper. Keeps every filter the same height and gives the
 * label a consistent position, which is what made the old rows look ragged —
 * some controls had labels, some didn't, so nothing lined up.
 */
export function FilterField({
  label,
  htmlFor,
  width = 'md',
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  width?: 'sm' | 'md' | 'lg' | 'auto';
  children: ReactNode;
  className?: string;
}) {
  const widths = {
    sm: 'w-28',
    md: 'w-40',
    lg: 'w-56',
    auto: '',
  } as const;

  return (
    <div className={cn(widths[width], className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
