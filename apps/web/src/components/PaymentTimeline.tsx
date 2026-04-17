import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Circle,
  ArrowRight,
  Ban,
  Loader2,
  AlertCircle,
  IndianRupee,
  CalendarDays,
  User,
  CreditCard,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useScheduleTimelineQuery, type TimelineEvent } from '../hooks/useInstallments';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { InstallmentStatus } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface PaymentTimelineProps {
  scheduleId: string;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------
const statusConfig: Record<
  string,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    lineColor: string;
    icon: React.ReactNode;
    label: string;
  }
> = {
  [InstallmentStatus.PAID]: {
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    borderColor: 'border-green-300 dark:border-green-700',
    lineColor: 'bg-green-300 dark:bg-green-700',
    icon: <CheckCircle2 className="h-5 w-5" />,
    label: 'Paid',
  },
  [InstallmentStatus.OVERDUE]: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-300 dark:border-red-700',
    lineColor: 'bg-red-300 dark:bg-red-700',
    icon: <AlertTriangle className="h-5 w-5" />,
    label: 'Overdue',
  },
  [InstallmentStatus.DUE_TODAY]: {
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    borderColor: 'border-blue-300 dark:border-blue-700',
    lineColor: 'bg-blue-300 dark:bg-blue-700',
    icon: <Clock className="h-5 w-5" />,
    label: 'Due Today',
  },
  [InstallmentStatus.UPCOMING]: {
    color: 'text-blue-500 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    lineColor: 'bg-blue-200 dark:bg-blue-800',
    icon: <Circle className="h-5 w-5" />,
    label: 'Upcoming',
  },
  [InstallmentStatus.PARTIALLY_PAID]: {
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    borderColor: 'border-yellow-300 dark:border-yellow-700',
    lineColor: 'bg-yellow-300 dark:bg-yellow-700',
    icon: <IndianRupee className="h-5 w-5" />,
    label: 'Partially Paid',
  },
  [InstallmentStatus.RESCHEDULED]: {
    color: 'text-gray-500 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    borderColor: 'border-gray-300 dark:border-gray-700',
    lineColor: 'bg-gray-300 dark:bg-gray-700',
    icon: <Ban className="h-5 w-5" />,
    label: 'Rescheduled',
  },
};

function getStatusConfig(status: string) {
  return (
    statusConfig[status] ?? {
      color: 'text-gray-500 dark:text-gray-400',
      bgColor: 'bg-gray-50 dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      lineColor: 'bg-gray-200 dark:bg-gray-700',
      icon: <Circle className="h-5 w-5" />,
      label: status.replace(/_/g, ' '),
    }
  );
}

// Determine if installment was paid late
function wasPaidLate(event: TimelineEvent): boolean {
  if (event.status !== InstallmentStatus.PAID || event.payments.length === 0)
    return false;
  const dueDate = new Date(event.dueDate);
  const paymentDate = new Date(event.payments[0].paymentDate);
  return paymentDate > dueDate;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PaymentTimeline({ scheduleId }: PaymentTimelineProps) {
  const { data: timeline, isLoading, isError } = useScheduleTimelineQuery(scheduleId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !timeline) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p className="text-sm">Failed to load timeline</p>
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <CalendarDays className="h-8 w-8 mb-2" />
        <p className="text-sm">No timeline data available</p>
      </div>
    );
  }

  return (
    <div className="max-h-[500px] overflow-y-auto pr-2">
      <div className="relative">
        {timeline.map((event, idx) => {
          const config = getStatusConfig(event.status);
          const isLast = idx === timeline.length - 1;
          const paidLate = wasPaidLate(event);

          // Override color if paid late
          const nodeColor = paidLate ? 'text-yellow-600 dark:text-yellow-400' : config.color;
          const nodeBg = paidLate ? 'bg-yellow-100 dark:bg-yellow-900/30' : config.bgColor;
          const nodeBorder = paidLate ? 'border-yellow-300 dark:border-yellow-700' : config.borderColor;
          const lineCol = paidLate ? 'bg-yellow-300 dark:bg-yellow-700' : config.lineColor;

          return (
            <div key={event.id} className="relative flex gap-4">
              {/* Line + Node */}
              <div className="flex flex-col items-center">
                {/* Node */}
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full border-2 shrink-0',
                    nodeBg,
                    nodeBorder,
                    nodeColor,
                  )}
                >
                  {paidLate ? (
                    <Clock className="h-5 w-5" />
                  ) : (
                    config.icon
                  )}
                </div>
                {/* Connecting line */}
                {!isLast && (
                  <div className={cn('w-0.5 flex-1 min-h-[24px]', lineCol)} />
                )}
              </div>

              {/* Content */}
              <div className={cn('flex-1 pb-6', isLast && 'pb-0')}>
                {/* Header */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('text-sm font-semibold', nodeColor)}>
                    EMI #{event.installmentNumber}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      nodeBg,
                      nodeColor,
                    )}
                  >
                    {paidLate ? 'Paid Late' : config.label}
                  </span>
                </div>

                {/* Due date + amount */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-1">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Due: {formatDateIN(event.dueDate)}
                  </span>
                  <span className="font-medium text-foreground">
                    {formatINR(event.amountDue)}
                  </span>
                </div>

                {/* Payment info if paid */}
                {event.payments.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {event.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2"
                      >
                        <span className="flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
                          <IndianRupee className="h-3 w-3" />
                          {formatINR(payment.amount)}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {formatDateIN(payment.paymentDate)}
                        </span>
                        <span className="flex items-center gap-1 capitalize">
                          <CreditCard className="h-3 w-3" />
                          {payment.paymentMode.replace(/_/g, ' ')}
                        </span>
                        {payment.collectedBy && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {payment.collectedBy}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Rescheduled info */}
                {event.isRescheduled && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <ArrowRight className="h-3.5 w-3.5" />
                    <span>Rescheduled to a new date</span>
                  </div>
                )}

                {/* Partially paid remaining */}
                {event.status === InstallmentStatus.PARTIALLY_PAID &&
                  event.remainingAmount > 0 && (
                    <div className="mt-1.5 text-xs text-yellow-600 dark:text-yellow-400">
                      Remaining: {formatINR(event.remainingAmount)}
                    </div>
                  )}

                {/* Notes */}
                {event.notes && (
                  <p className="mt-1.5 text-xs text-muted-foreground italic">
                    {event.notes}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
