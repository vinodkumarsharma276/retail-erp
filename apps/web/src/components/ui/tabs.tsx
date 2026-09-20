import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Segmented control used for list-page view switching (Today's Scheduled /
 * All Overdue / Paid, Current FY / Last FY, and so on).
 *
 * Deliberately NOT a place for actions. The Sales page previously mixed an
 * "Approve" action into the same strip as its financial-year filters, which
 * made a mutating operation look like a harmless view toggle.
 */

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Optional trailing count, e.g. number of overdue rows. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: TabsProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const enabled = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !item.disabled);
    if (enabled.length === 0) return;
    const pos = enabled.findIndex(({ i }) => i === from);
    const next = enabled[(pos + delta + enabled.length) % enabled.length];
    onChange(next.item.value);
    refs.current[next.i]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(index, 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(index, -1);
              }
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              selected
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded px-1 text-[0.6875rem] font-semibold',
                  selected ? 'bg-muted text-muted-foreground' : 'text-muted-foreground',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
