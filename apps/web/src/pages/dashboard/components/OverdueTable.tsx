import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatINR } from '@retailerp/shared-utils';
import { useOverdueInstallmentsQuery } from '../../../hooks/useDashboard';

export function OverdueTable() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOverdueInstallmentsQuery();

  const count = data?.length ?? 0;
  const totalAmount = (data ?? []).reduce(
    (sum, item) => sum + Number(item.amountDue ?? 0),
    0,
  );

  const goToOverdue = () => navigate('/installments?tab=overdue');

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">Overdue Installments</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Installments past their due date
          </p>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mb-2 text-destructive" />
          <p className="text-sm">Failed to load overdue installments</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && count === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-2 text-green-500 opacity-70" />
          <p className="text-sm font-medium">No overdue installments</p>
          <p className="text-xs mt-1">All collections are up to date</p>
        </div>
      )}

      {/* Summary button */}
      {!isLoading && !isError && count > 0 && (
        <button
          type="button"
          onClick={goToOverdue}
          className={cn(
            'w-full flex items-center justify-between rounded-lg border border-red-200 dark:border-red-900/50',
            'bg-red-50 dark:bg-red-900/20 px-4 py-4 text-left',
            'hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors',
          )}
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-100 dark:bg-red-900/40 p-2.5">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="font-mono text-2xl font-semibold text-red-700 dark:text-red-400 leading-tight">
                {count}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                overdue
                {totalAmount > 0 && (
                  <>
                    {' \u00b7 Total due: '}
                    <span className="font-medium text-red-600 dark:text-red-400">
                      {formatINR(totalAmount)}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-400">
            View all
            <ArrowRight className="h-4 w-4" />
          </div>
        </button>
      )}
    </div>
  );
}
