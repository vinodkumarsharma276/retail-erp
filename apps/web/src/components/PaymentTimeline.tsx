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
  History,
  GitMerge,
  GitBranch,
  FileText,
  Flag,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useScheduleTimelineQuery,
  useScheduleRollLogQuery,
  type TimelineEvent,
  type RollLogEvent,
} from '../hooks/useInstallments';
import { formatInstallmentLabel } from '../lib/installment-label';
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
// Roll-log event icons + colors
// ---------------------------------------------------------------------------
const rollLogConfig: Record<
  RollLogEvent['eventType'],
  { icon: React.ReactNode; color: string; bg: string }
> = {
  installment_due: {
    icon: <Clock className="h-4 w-4" />,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
  },
  sub_created: {
    icon: <GitBranch className="h-4 w-4" />,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
  },
  payment_recorded: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
  },
  partial_payment: {
    icon: <IndianRupee className="h-4 w-4" />,
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
  chain_absorbed: {
    icon: <GitMerge className="h-4 w-4" />,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30',
  },
  chain_closed_manual: {
    icon: <Ban className="h-4 w-4" />,
    color: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800/50',
  },
  schedule_completed: {
    icon: <Flag className="h-4 w-4" />,
    color: 'text-green-700 dark:text-green-500',
    bg: 'bg-green-100 dark:bg-green-900/30',
  },
  note_added: {
    icon: <FileText className="h-4 w-4" />,
    color: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800/50',
  },
};

function RollLogSection({ scheduleId }: { scheduleId: string }) {
  const { data: events, isLoading } = useScheduleRollLogQuery(scheduleId);

  if (isLoading || !events || events.length === 0) return null;

  return (
    <div className="mt-6 border-t pt-4">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-foreground">
        <History className="h-4 w-4" />
        Activity Log ({events.length})
      </div>
      <div className="max-h-[320px] overflow-y-auto pr-2 space-y-2">
        {events.map((e) => {
          const cfg = rollLogConfig[e.eventType] ?? rollLogConfig.note_added;
          return (
            <div
              key={e.id}
              className="flex gap-3 items-start text-xs rounded-md px-3 py-2 bg-muted/30"
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  cfg.bg,
                  cfg.color,
                )}
              >
                {cfg.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-foreground">{e.displayMessage}</p>
                <div className="mt-0.5 flex items-center gap-3 text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {formatDateIN(e.eventDate)}
                  </span>
                  {e.actor && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {e.actor.fullName}
                    </span>
                  )}
                  <span className="uppercase tracking-wide text-[10px] text-muted-foreground/80">
                    {e.eventType.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
                    EMI {formatInstallmentLabel(event)}
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
                  {event.isClosed && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      Chain closed
                    </span>
                  )}
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
                            {payment.collectorName ?? payment.collectedBy}
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
      <RollLogSection scheduleId={scheduleId} />
    </div>
  );
}
