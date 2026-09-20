import { Loader2 } from 'lucide-react';
import { formatINR } from '@retailerp/shared-utils';
import { useCustomerReliabilityQuery } from '../hooks/useCustomers';
import { ReliabilityBadge } from './ReliabilityBadge';

interface Props {
  customerId: string;
  variant?: 'card' | 'banner';
}

export function CustomerReliabilityCard({ customerId, variant = 'card' }: Props) {
  const { data, isLoading, isError } = useCustomerReliabilityQuery(customerId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reliability...
      </div>
    );
  }
  if (isError || !data) return null;

  if (variant === 'banner') {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
        <div className="mb-2"><ReliabilityBadge metrics={data} /></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{data.activeOverdueEmiCount} active overdue EMI(s)</span>
          <span>{data.promisesBrokenEmiCount} broken promised EMI(s)</span>
          <span>Outstanding {formatINR(data.totalOutstanding)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Installment Reliability</h3>
        <ReliabilityBadge metrics={data} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Metric label="Promises made" value={data.promisesMade} />
        <Metric label="Kept" value={data.promisesKept} />
        <Metric label="Partially kept" value={data.promisesPartiallyKept} />
        <Metric label="Broken promises" value={data.promisesBroken} />
        <Metric label="Broken EMI count" value={data.promisesBrokenEmiCount} />
        <Metric label="Overdue EMIs" value={data.activeOverdueEmiCount} />
        <Metric label="Outstanding" value={formatINR(data.totalOutstanding)} />
        <Metric label="Avg DPD" value={data.avgDpdAtPayment == null ? '-' : `${data.avgDpdAtPayment.toFixed(1)}d`} />
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
