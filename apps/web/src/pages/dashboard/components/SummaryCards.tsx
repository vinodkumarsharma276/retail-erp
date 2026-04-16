import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Package,
  Banknote,
  Loader2,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatINR } from '@retailerp/shared-utils';
import type { DashboardSummary } from '../../../hooks/useDashboard';

interface SummaryCardsProps {
  data: DashboardSummary | undefined;
  isLoading: boolean;
}

export function SummaryCards({ data, isLoading }: SummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SummaryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const salesUp = data.salesChangePercent >= 0;
  const collectionPercent =
    data.todaysCollections.expected > 0
      ? Math.round(
          (data.todaysCollections.collected / data.todaysCollections.expected) * 100,
        )
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Sales This Month */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Sales This Month
          </span>
          <div className="rounded-lg bg-blue-50 p-2">
            <TrendingUp className="h-4 w-4 text-blue-600" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">
          {formatINR(data.totalSalesThisMonth)}
        </p>
        <div className="mt-2 flex items-center gap-1 text-sm">
          {salesUp ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-600" />
          )}
          <span
            className={cn(
              'font-medium',
              salesUp ? 'text-green-600' : 'text-red-600',
            )}
          >
            {salesUp ? '+' : ''}
            {data.salesChangePercent.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">vs last month</span>
        </div>
      </div>

      {/* Pending Installments */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Pending Installments
          </span>
          <div className="rounded-lg bg-amber-50 p-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">
          {data.pendingInstallments.count}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Overdue amount:{' '}
          <span className="font-medium text-red-600">
            {formatINR(data.pendingInstallments.totalAmount)}
          </span>
        </p>
      </div>

      {/* Stock Value */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Stock Value
          </span>
          <div className="rounded-lg bg-purple-50 p-2">
            <Package className="h-4 w-4 text-purple-600" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">
          {formatINR(data.stockValue)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Total inventory value</p>
      </div>

      {/* Today's Collections */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Today's Collections
          </span>
          <div className="rounded-lg bg-green-50 p-2">
            <Banknote className="h-4 w-4 text-green-600" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">
          {formatINR(data.todaysCollections.collected)}
        </p>
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              Expected: {formatINR(data.todaysCollections.expected)}
            </span>
            <span className="font-medium">{collectionPercent}%</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                collectionPercent >= 80
                  ? 'bg-green-500'
                  : collectionPercent >= 50
                    ? 'bg-amber-500'
                    : 'bg-red-500',
              )}
              style={{ width: `${Math.min(collectionPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------
function SummaryCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-8 w-8 rounded-lg bg-muted" />
      </div>
      <div className="h-8 w-32 rounded bg-muted mb-2" />
      <div className="h-3 w-40 rounded bg-muted" />
    </div>
  );
}
