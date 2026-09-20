import { CheckCircle2, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatDateIN } from '@retailerp/shared-utils';

interface CompletionBadgeProps {
  completedAt?: string | null;
  /** Show a larger hero-style badge with animation (for detail headers). */
  variant?: 'inline' | 'hero';
  className?: string;
}

/**
 * Visual indicator that a sale is fully settled. Matches the app's teal/emerald
 * primary palette and uses a soft pulse animation on the hero variant.
 */
export function CompletionBadge({ completedAt, variant = 'inline', className }: CompletionBadgeProps) {
  const isCompleted = !!completedAt;

  if (variant === 'hero') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium',
          'border transition-all duration-500',
          isCompleted
            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 shadow-sm animate-badge-shine'
            : 'border-amber-200 bg-amber-50 text-amber-700',
          'dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
          className,
        )}
      >
        {isCompleted ? (
          <>
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
            <span>
              Completed
              {completedAt && (
                <span className="ml-1 font-normal opacity-80">· {formatDateIN(completedAt)}</span>
              )}
            </span>
          </>
        ) : (
          <>
            <Clock className="h-4 w-4" />
            <span>Active</span>
          </>
        )}
      </div>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isCompleted
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
          : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
        'dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50',
        className,
      )}
      title={isCompleted && completedAt ? `Completed on ${formatDateIN(completedAt)}` : 'Sale still active'}
    >
      {isCompleted ? (
        <>
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </>
      ) : (
        <>
          <Clock className="h-3 w-3" />
          Active
        </>
      )}
    </span>
  );
}
