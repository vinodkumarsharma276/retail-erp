import { Loader2, ShieldCheck, ShieldAlert, ShieldX, Shield } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useCustomerInstallmentHistoryQuery,
  type CustomerInstallmentHistory,
} from '../hooks/useCustomers';
import { formatINR } from '@retailerp/shared-utils';

const ratingStyles: Record<
  CustomerInstallmentHistory['rating'],
  { badge: string; text: string; icon: React.ReactNode; label: string }
> = {
  excellent: {
    badge: 'bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300',
    text: 'text-green-700 dark:text-green-400',
    icon: <ShieldCheck className="h-5 w-5" />,
    label: 'Excellent',
  },
  good: {
    badge: 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
    text: 'text-blue-700 dark:text-blue-400',
    icon: <Shield className="h-5 w-5" />,
    label: 'Good',
  },
  fair: {
    badge: 'bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-300',
    text: 'text-yellow-700 dark:text-yellow-400',
    icon: <ShieldAlert className="h-5 w-5" />,
    label: 'Fair',
  },
  poor: {
    badge: 'bg-red-100 border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300',
    text: 'text-red-700 dark:text-red-400',
    icon: <ShieldX className="h-5 w-5" />,
    label: 'Poor',
  },
};

interface Props {
  customerId: string;
  variant?: 'card' | 'banner';
}

export function CustomerReliabilityCard({ customerId, variant = 'card' }: Props) {
  const { data, isLoading, isError } = useCustomerInstallmentHistoryQuery(customerId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reliability...
      </div>
    );
  }
  if (isError || !data) return null;
  if (data.totalSchedules === 0) {
    if (variant === 'banner') {
      return (
        <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          No installment history for this customer yet — this is their first installment sale.
        </div>
      );
    }
    return null;
  }

  const cfg = ratingStyles[data.rating];

  if (variant === 'banner') {
    return (
      <div className={cn('flex items-start gap-3 rounded-md border px-4 py-3', cfg.badge)}>
        <div className="mt-0.5">{cfg.icon}</div>
        <div className="flex-1 min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
            <span>Customer reliability: {cfg.label}</span>
            <span className="font-normal">Score {data.reliabilityScore}/100</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              {data.paidOnTime}/{data.totalInstallments} paid on time
            </span>
            {data.paidLate > 0 && <span>{data.paidLate} late</span>}
            {data.absorbed > 0 && <span>{data.absorbed} chain absorbed</span>}
            {data.active > 0 && (
              <span>
                {data.active} active schedule{data.active === 1 ? '' : 's'}
              </span>
            )}
            {data.averageDelayDays > 0 && (
              <span>Avg delay {data.averageDelayDays.toFixed(1)}d</span>
            )}
            {data.longestOverdueDays > 0 && (
              <span>Longest overdue {data.longestOverdueDays}d</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={cn('flex items-center gap-2 font-semibold', cfg.text)}>
          {cfg.icon}
          Installment Reliability
        </span>
        <span
          className={cn(
            'ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
            cfg.badge,
          )}
        >
          {cfg.label} &middot; {data.reliabilityScore}/100
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Metric label="Schedules" value={data.totalSchedules} />
        <Metric label="Active" value={data.active} />
        <Metric
          label="Completed"
          value={`${data.completedOnTime} on time / ${data.completedLate} late`}
        />
        <Metric label="Paid on time" value={`${data.paidOnTime} / ${data.totalInstallments}`} />
        <Metric label="Paid late" value={data.paidLate} />
        <Metric label="Chains absorbed" value={data.absorbed} />
        <Metric label="Reschedules" value={data.reschedulesCreated} />
        <Metric
          label="Avg delay"
          value={data.averageDelayDays > 0 ? `${data.averageDelayDays.toFixed(1)}d` : '—'}
        />
        <Metric
          label="Longest overdue"
          value={data.longestOverdueDays > 0 ? `${data.longestOverdueDays}d` : '—'}
        />
        <Metric
          label="Lifetime financed"
          value={formatINR(data.lifetimeFinancedAmount)}
        />
        <Metric label="Lifetime paid" value={formatINR(data.lifetimePaid)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
