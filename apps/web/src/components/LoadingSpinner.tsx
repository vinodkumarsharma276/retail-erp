import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface LoadingSpinnerProps {
  message?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function LoadingSpinner({
  message,
  className,
  size = 'md',
}: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12',
        className,
      )}
    >
      <Loader2
        className={cn('animate-spin text-primary', sizeClasses[size])}
      />
      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  );
}

/**
 * Full-page centered loading spinner — use for page-level loading states.
 */
export function PageLoader({ message }: { message?: string }) {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center">
      <LoadingSpinner message={message} size="lg" />
    </div>
  );
}
