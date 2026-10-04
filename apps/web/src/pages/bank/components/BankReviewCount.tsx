import { useQuery } from '@tanstack/react-query';
import { cn } from '../../../lib/utils';
import { api } from '../lib/api';

/** Sidebar badge: bank transactions waiting for review in the current header shop scope. */
export function BankReviewCount({ compact }: { compact: boolean }) {
  const { data: pending } = useQuery({
    queryKey: ['bank-review-count', 'sidebar'],
    queryFn: () => api.transactions({ review: 'pending', pageSize: 10 }).then((r) => r.total),
    refetchInterval: 30_000,
    retry: false,
  });
  if (!pending) return null;
  if (compact) return <span aria-label={`${pending} to review`} className="absolute right-1.5 top-1.5 size-2 rounded-full bg-warning" />;
  return (
    <span
      className={cn('ml-auto rounded-full bg-warning-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-warning')}
      aria-label={`${pending} to review`}
    >
      {pending > 999 ? '999+' : pending}
    </span>
  );
}
