import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Package,
  Banknote,
  
  Receipt } from 'lucide-react';
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
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
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
    <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {/* Total Sales This Month */}
      <div className="hover-lift rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Sales This Month
          </span>
          <div className="rounded-lg bg-info-muted p-2">
            <TrendingUp className="h-4 w-4 text-info" />
          </div>
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight">
          {formatINR(data.totalSalesThisMonth)}
        </p>
        <div className="mt-2 flex items-center gap-1 text-sm">
          {salesUp ? (
            <TrendingUp className="h-3.5 w-3.5 text-success" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-destructive" />
          )}
          <span
            className={cn(
              'font-medium',
              salesUp ? 'text-success' : 'text-destructive',
            )}
          >
            {salesUp ? '+' : ''}
            {data.salesChangePercent.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">vs last month</span>
        </div>
      </div>

      {/* Pending Installments */}
      <div className="hover-lift rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Pending Installments
          </span>
          <div className="rounded-lg bg-warning-muted p-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight">
          {data.pendingInstallments.count}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Overdue amount:{' '}
          <span className="font-medium text-destructive">
            {formatINR(data.pendingInstallments.totalAmount)}
          </span>
        </p>
      </div>

      {/* Stock Value */}
      <div className="hover-lift rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Stock Value
          </span>
          <div className="rounded-lg bg-primary-muted p-2">
            <Package className="h-4 w-4 text-primary" />
          </div>
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight">
          {formatINR(data.stockValue)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Total inventory value</p>
      </div>

      {/* Today's Collections */}
      <div className="hover-lift rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Today's Collections
          </span>
          <div className="rounded-lg bg-success-muted p-2">
            <Banknote className="h-4 w-4 text-success" />
          </div>
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight">
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
                  ? 'bg-success'
                  : collectionPercent >= 50
                    ? 'bg-warning'
                    : 'bg-destructive',
              )}
              style={{ width: `${Math.min(collectionPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Expenses Current FY */}
      <div className="hover-lift rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Expenses Current FY
          </span>
          <div className="rounded-lg bg-destructive-muted p-2">
            <Receipt className="h-4 w-4 text-destructive" />
          </div>
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight">
          {formatINR(data.totalExpensesCurrentFY)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">April to March</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------
function SummaryCardSkeleton() {
  return (
    <div className="hover-lift rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton h-8 w-8 rounded-lg" />
      </div>
      <div className="skeleton mb-2 h-8 w-32 rounded" />
      <div className="skeleton h-3 w-40 rounded" />
    </div>
  );
}
