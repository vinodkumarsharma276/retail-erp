import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { ReliabilityMetrics } from '@retailerp/shared-types';
import { cn } from '../lib/utils';
import { formatINR } from '@retailerp/shared-utils';

const styles = {
  low: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  medium: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  high: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300',
} as const;

export function ReliabilityBadge({ metrics, className }: { metrics: ReliabilityMetrics; className?: string }) {
  const Icon = metrics.riskBand === 'low' ? ShieldCheck : metrics.riskBand === 'medium' ? ShieldAlert : ShieldX;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium',
        styles[metrics.riskBand],
        className,
      )}
      title={`Broken promises: ${metrics.promisesBrokenEmiCount} EMI(s) · Overdue: ${metrics.activeOverdueEmiCount} · Outstanding: ${formatINR(metrics.totalOutstanding)}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="capitalize">{metrics.riskBand} risk</span>
      <span className="opacity-75">{metrics.promisesBrokenEmiCount} broken EMI</span>
    </div>
  );
}
