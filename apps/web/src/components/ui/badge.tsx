import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Badges are limited to six semantic tones on purpose. The previous design
 * gave nearly every status its own hue (pink, indigo, purple, teal…), which
 * turned dense tables into confetti and made genuinely urgent states — overdue,
 * unmatched — no louder than routine ones. Meaning now comes from the tone;
 * identity comes from the label.
 */
export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type BadgeVariant = 'soft' | 'solid' | 'outline';

const toneClasses: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft: {
    neutral: 'bg-muted text-muted-foreground',
    primary: 'bg-primary-muted text-primary',
    success: 'bg-success-muted text-success',
    warning: 'bg-warning-muted text-warning',
    danger: 'bg-destructive-muted text-destructive',
    info: 'bg-info-muted text-info',
  },
  solid: {
    neutral: 'bg-muted-foreground text-background',
    primary: 'bg-primary text-primary-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
    danger: 'bg-destructive text-destructive-foreground',
    info: 'bg-info text-info-foreground',
  },
  outline: {
    neutral: 'border border-border-strong text-muted-foreground',
    primary: 'border border-primary/40 text-primary',
    success: 'border border-success/40 text-success',
    warning: 'border border-warning/40 text-warning',
    danger: 'border border-destructive/40 text-destructive',
    info: 'border border-info/40 text-info',
  },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  /** Adds a small leading dot — useful for status columns scanned vertically. */
  dot?: boolean;
}

export function Badge({
  className,
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
        toneClasses[variant][tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            variant === 'solid' ? 'bg-current opacity-70' : 'bg-current',
          )}
        />
      )}
      {children}
    </span>
  );
}
