import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * The app's single surface primitive. Elevation is carried by a hairline
 * border plus a very soft shadow — not by a heavy border, which is what made
 * the previous screens feel boxy when cards nested inside cards.
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }
>(({ className, flush = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-border bg-card text-card-foreground',
      flush ? 'shadow-none' : 'shadow-sm',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-start justify-between gap-3 px-4 py-3', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-subtitle', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-caption', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('px-4 pb-4', className)} {...props} />
));
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center gap-2 border-t border-border px-4 py-3', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

/**
 * Compact KPI tile used across the dashboard and list-page summary strips.
 * Keeps label / value / delta alignment identical everywhere.
 */
export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
}

const toneRing: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success-muted text-success',
  warning: 'bg-warning-muted text-warning',
  destructive: 'bg-destructive-muted text-destructive',
  info: 'bg-info-muted text-info',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  className,
  ...props
}: StatCardProps) {
  return (
    <Card className={cn('p-4', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-overline">{label}</p>
        {icon && (
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              toneRing[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="tabular mt-2 text-xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {hint && <div className="mt-1 text-caption">{hint}</div>}
    </Card>
  );
}
