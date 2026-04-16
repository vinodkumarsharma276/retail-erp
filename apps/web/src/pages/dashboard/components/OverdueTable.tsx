import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import {
  useOverdueInstallmentsQuery,
  type OverdueInstallmentDashItem,
} from '../../../hooks/useDashboard';

export function OverdueTable() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOverdueInstallmentsQuery();

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
        {data && data.length > 0 && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {data.length} overdue
          </span>
        )}
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
      {!isLoading && !isError && data && data.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-2 text-green-500 opacity-70" />
          <p className="text-sm font-medium">No overdue installments</p>
          <p className="text-xs mt-1">All collections are up to date</p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && data && data.length > 0 && (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">
                  Customer
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Phone
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Product
                </th>
                <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                  EMI #
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Amount Due
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Due Date
                </th>
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">
                  Overdue
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr
                  key={item.installmentId}
                  onClick={() => navigate(`/installments/${item.scheduleId}`)}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <td className="px-5 py-3 font-medium">{item.customerName}</td>
                  <td className="px-3 py-3">
                    <a
                      href={`tel:${item.customerPhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary hover:underline"
                    >
                      {item.customerPhone}
                    </a>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground max-w-[150px] truncate">
                    {item.productName}
                  </td>
                  <td className="px-3 py-3 text-center font-medium">
                    #{item.installmentNumber}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-red-600">
                    {formatINR(item.amountDue)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateIN(item.dueDate)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <OverdueBadge days={item.daysOverdue} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overdue severity badge
// ---------------------------------------------------------------------------
function OverdueBadge({ days }: { days: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        days > 30
          ? 'bg-red-100 text-red-700'
          : days > 7
            ? 'bg-amber-100 text-amber-700'
            : 'bg-blue-100 text-blue-700',
      )}
    >
      {days}d
    </span>
  );
}
