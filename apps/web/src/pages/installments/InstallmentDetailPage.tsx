import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Banknote,
  Phone,
  ExternalLink,
  Eye,
  EyeOff,
  Undo2,
  X,
  History,
  ChevronDown,
  ChevronRight,
  Pencil,
  Info,
  CalendarClock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useScheduleDetailQuery, useRevertPaymentMutation, useMovePaymentMutation, useCorrectPaymentMutation, useUndoReschedulePreviewQuery, useUndoRescheduleMutation, useInstallmentPromisesQuery, useUpdatePenaltyPerDayMutation } from '../../hooks/useInstallments';
import { useToastStore } from '../../stores/toast-store';
import { StatusBadge } from '../../components/StatusBadge';
import { PaymentTimeline } from '../../components/PaymentTimeline';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import { PromiseDialog } from '../../components/PromiseDialog';
import { PromiseChip, PromiseHistory } from '../../components/PromiseHistory';
import { useAuthStore } from '../../stores/auth-store';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { InstallmentStatus } from '@retailerp/shared-types';
import { formatInstallmentLabel } from '../../lib/installment-label';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function InstallmentDetailPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useScheduleDetailQuery(scheduleId);
  // Every promise, so labels (1.1, 1.2 …) and outcomes show in history.
  const { data: promises = [] } = useInstallmentPromisesQuery({ scheduleId });
  const role = useAuthStore((s) => s.user?.role);
  const canCancelPromise = role === 'owner' || role === 'admin' || role === 'accountant';
  // EMIs to pre-tick in the promise dialog; null = closed.
  const [promiseFor, setPromiseFor] = useState<string[] | null>(null);

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
    initialScenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
  } | null>(null);

  // Revert dialog state
  const [revertTarget, setRevertTarget] = useState<{
    paymentId: string;
    amount: number;
    installmentLabel: string;
    installmentId: string;
    installmentNumber: number | null;
    /** Original payment date (YYYY-MM-DD) — pre-filled in the move-payment flow. */
    originalPaymentDate: string | null;
    /** Installment due date — used to compute days-overdue suggestion. */
    dueDate: string | null;
    /**
     * Remaining balance the row will have AFTER the revert. Drives the
     * suggested overdue-interest calculation (interest is on what's owed,
     * not on what was originally due).
     */
    expectedRemainingAfterRevert: number;
  } | null>(null);
  const [revertReason, setRevertReason] = useState('');
  const [revertApplyInterest, setRevertApplyInterest] = useState(false);
  const [revertInterestAmount, setRevertInterestAmount] = useState<string>('');
  const [revertInterestNotes, setRevertInterestNotes] = useState('');
  const [revertCascade, setRevertCascade] = useState(true);
  // "Fix mis-record" mode inside the revert dialog
  const [revertMoveEnabled, setRevertMoveEnabled] = useState(false);
  const [revertMoveTargetId, setRevertMoveTargetId] = useState('');
  const [revertMovePaymentDate, setRevertMovePaymentDate] = useState('');
  const [revertMoveInterestEnabled, setRevertMoveInterestEnabled] = useState(false);
  const [revertMoveInterestAmount, setRevertMoveInterestAmount] = useState<string>('');
  const [revertMoveInterestNotes, setRevertMoveInterestNotes] = useState('');
  const revertMutation = useRevertPaymentMutation();
  const moveMutation = useMovePaymentMutation();

  // Modify (correct wrong amount) dialog state
  const [modifyTarget, setModifyTarget] = useState<{
    paymentId: string;
    installmentId: string;
    installmentLabel: string;
    recordedAmount: number;
    amountDue: number;
    /** Installment due date in YYYY-MM-DD — used for interest suggestion. */
    dueDate: string | null;
  } | null>(null);
  const [modifyCorrectAmount, setModifyCorrectAmount] = useState('');
  const [modifyReason, setModifyReason] = useState('');
  const [modifyApplyInterest, setModifyApplyInterest] = useState(false);
  const [modifyInterestAmount, setModifyInterestAmount] = useState('');
  const [modifyInterestNotes, setModifyInterestNotes] = useState('');
  const correctMutation = useCorrectPaymentMutation();

  // Undo reschedule dialog state
  const [undoRescheduleTarget, setUndoRescheduleTarget] = useState<{
    installmentId: string;
    installmentLabel: string;
  } | null>(null);
  const [undoRescheduleReason, setUndoRescheduleReason] = useState('');
  const undoReschedulePreviewQuery = useUndoReschedulePreviewQuery(
    undoRescheduleTarget?.installmentId,
    !!undoRescheduleTarget,
  );
  const undoRescheduleMutation = useUndoRescheduleMutation();

  // Toggle to show/hide rescheduled (superseded) rows
  const [showRescheduled, setShowRescheduled] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  // Per-row override: when an overdue installment has been absorbed into
  // future primaries (remainingAmount === 0) the Pay button is hidden by
  // default. Toggling "Record manually" for that row re-enables it so the
  // collector can still record cash actually received against the missed
  // installment (server treats it as an overpayment that R7 distributes).
  const [manuallyEnabled, setManuallyEnabled] = useState<Set<string>>(new Set());
  const toggleManual = (id: string) => {
    setManuallyEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Schedule Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The installment schedule you are looking for does not exist.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Installments
        </button>
      </div>
    );
  }

  const { schedule, installments, sale, customer, product } = data;

  // Compute distribution preview for Undo / Modify dialogs.
  // Returns how the given amount will be spread across upcoming installments
  // (or that a new installment will be created).
  const computeDistributionPreview = (amount: number, excludeId: string) => {
    const upcoming = installments.filter(
      (i: any) =>
        ['upcoming', 'due_today', 'overdue'].includes(i.status) &&
        Number(i.remainingAmount) > 0 &&
        !i.isRescheduled &&
        i.id !== excludeId,
    );
    if (upcoming.length === 0) {
      return { count: 0, perRow: amount, createNew: true };
    }
    return {
      count: upcoming.length,
      perRow: Math.round((amount / upcoming.length) * 100) / 100,
      createNew: false,
    };
  };

  const rescheduledCount = installments.filter(
    (i: any) => i.status === InstallmentStatus.RESCHEDULED,
  ).length;

  const visibleInstallments = showRescheduled
    ? installments
    : installments.filter(
        (i: any) => i.status !== InstallmentStatus.RESCHEDULED,
      );
  const promisesByInstallmentId = new Map<string, typeof promises>();
  for (const promise of promises) {
    if (promise.status === 'cancelled') continue;
    for (const installmentId of promise.coveredInstallmentIds) {
      const list = promisesByInstallmentId.get(installmentId) ?? [];
      list.push(promise);
      promisesByInstallmentId.set(installmentId, list);
    }
  }

  const actionableStatuses: string[] = [
    InstallmentStatus.UPCOMING,
    InstallmentStatus.OVERDUE,
    InstallmentStatus.DUE_TODAY,
    InstallmentStatus.PARTIALLY_PAID,
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-display">Installment Schedule</h1>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={schedule.status} />
            <span className="text-sm text-muted-foreground">
              {schedule.numInstallments} EMIs
            </span>
          </div>
        </div>
      </div>

      {/* Top section: Sale summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 mb-6">
        {/* Sale + Finance details */}
        <div className="lg:col-span-3 rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Sale Summary</h2>
            <Link
              to={`/sales/${sale.id}`}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View Sale
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoRow label="Sale Number" value={sale.saleNumber} />
            <InfoRow label="Sale Date" value={formatDateIN(sale.saleDate)} />
            <InfoRow label="Total Amount" value={formatINR(sale.totalAmount)} />
            <InfoRow label="Down Payment" value={formatINR(sale.downPayment)} />
            <InfoRow
              label="Interest Rate"
              value={`${sale.interestRate}% / month`}
            />
            <PenaltyRateRow
              scheduleId={schedule.id}
              perDay={sale.effectivePenaltyPerDay}
              isDefault={sale.penaltyPerDayIsDefault}
            />
            <InfoRow label="File Charge" value={formatINR(sale.fileCharge)} />
            <InfoRow label="EMI Amount" value={formatINR(sale.emiAmount)} />
            <InfoRow
              label="Installments"
              value={String(sale.numInstallments)}
            />
            <InfoRow
              label="Total Payable"
              value={formatINR(schedule.totalPayable)}
            />
          </dl>
        </div>

        {/* Customer + Product cards */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-3">Customer</h2>
            <dl className="space-y-2">
              <InfoRow label="Name" value={customer.name} />
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Phone
                </dt>
                <dd className="mt-0.5">
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {customer.phone}
                  </a>
                </dd>
              </div>
              <InfoRow label="Code" value={customer.customerCode} />
              {customer.city && (
                <InfoRow label="City" value={customer.city} />
              )}
            </dl>
            <Link
              to={`/customers/${customer.id}`}
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              View Customer
            </Link>
          </div>

          {/* Product */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-3">Product</h2>
            <dl className="space-y-2">
              <InfoRow label="Brand" value={product.brand} />
              <InfoRow label="Model" value={product.modelNumber} />
              {product.serialNumber && (
                <InfoRow label="Serial Number" value={product.serialNumber} />
              )}
            </dl>
            <Link
              to={`/products/${product.id}`}
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              View Product
            </Link>
          </div>
        </div>
      </div>

      {/* Middle section: Payment Timeline (collapsed by default) */}
      <div className="rounded-lg border bg-card mb-6">
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          className="w-full flex items-center justify-between gap-2 p-6 text-left hover:bg-muted/30 transition-colors rounded-lg"
          aria-expanded={showTimeline}
        >
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Payment Timeline & Activity Log</h2>
          </div>
          {showTimeline ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
        {showTimeline && (
          <div className="px-6 pb-6 -mt-2">
            <PaymentTimeline scheduleId={scheduleId!} />
          </div>
        )}
      </div>

      <PromiseHistory
        promises={promises}
        canCancel={canCancelPromise}
        onAdd={installments.some((i: any) => Number(i.remainingAmount) > 0) ? () => setPromiseFor([]) : undefined}
      />

      {/* Bottom section: Installment table */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">All Installments</h2>
          {rescheduledCount > 0 && (
            <button
              onClick={() => setShowRescheduled((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRescheduled ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {showRescheduled
                ? 'Hide rescheduled'
                : `Show ${rescheduledCount} rescheduled`}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  #
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Due Date
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Amount Due
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Amount Paid
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                  Remaining
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Payment Date
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Mode
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Actions
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                  Override
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleInstallments.map((inst) => {
                const remNum = Number(inst.remainingAmount) || 0;
                const statusActionable = actionableStatuses.includes(inst.status);
                const isAbsorbed = statusActionable && remNum <= 0;
                const canPay = statusActionable && (remNum > 0 || manuallyEnabled.has(inst.id));
                const lastPayment =
                  inst.payments?.length > 0
                    ? inst.payments[inst.payments.length - 1]
                    : null;
                const activePromises = promisesByInstallmentId.get(inst.id) ?? [];

                return (
                  <tr
                    key={inst.id}
                    className={cn(
                      'border-b last:border-0 transition-colors',
                      inst.status === InstallmentStatus.OVERDUE &&
                        'bg-red-50/50 dark:bg-red-950/20',
                      inst.status === InstallmentStatus.RESCHEDULED &&
                        'bg-gray-50/50 dark:bg-gray-800/30 opacity-60',
                    )}
                  >
                    <td className="px-3 py-2.5 font-medium">
                      {formatInstallmentLabel(inst).replace(/^#/, '')}
                      {inst.rescheduledFromId && (
                        <span className="ml-1 text-xs text-amber-600 font-normal">(Remainder)</span>
                      )}
                      {inst.notes?.includes('Early collection scheduled') && (
                        <span className="ml-1 text-xs text-blue-600 font-normal">(Early)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {formatDateIN(inst.dueDate)}
                      {activePromises.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {activePromises.map((promise) => (
                            <div key={promise.id}>
                              <PromiseChip promise={promise} />
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {formatINR(inst.amountDue)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-green-600">
                      {formatINR(inst.amountPaid)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right',
                        inst.remainingAmount > 0
                          ? 'text-red-600 font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      {formatINR(inst.remainingAmount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={inst.status} />
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {lastPayment
                        ? formatDateIN(lastPayment.paymentDate)
                        : '--'}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-muted-foreground">
                      {lastPayment
                        ? lastPayment.paymentMode.replace(/_/g, ' ')
                        : '--'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {canPay && (
                          <button
                            onClick={() =>
                              setPaymentTarget({
                                id: inst.id,
                                amount: remNum,
                                number: inst.installmentNumber,
                              })
                            }
                            className={cn(
                              'flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white',
                              'hover:bg-green-700 transition-colors',
                            )}
                          >
                            <Banknote className="h-3 w-3" />
                            Pay
                          </button>
                        )}
                        {remNum > 0 && statusActionable && (
                          <button
                            onClick={() => setPromiseFor([inst.id])}
                            title="Customer gave a date to pay — no money today"
                            className={cn(
                              'flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground',
                              'hover:bg-muted transition-colors',
                            )}
                          >
                            <CalendarClock className="h-3 w-3" />
                            Promise
                          </button>
                        )}
                        {/*
                         * "Reschedule" removed. EMIs are never moved any more, and
                         * its endpoint no longer exists. A customer's new date is
                         * recorded as a promise instead (see Part payment, and the
                         * planned "Record promise" action for no-payment cases).
                         */}
                        {inst.isRescheduled && inst.rescheduledTo && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            Moved to #{inst.rescheduledTo.installmentNumber}
                          </span>
                        )}
                        {/* Undo Reschedule — visible on:
                             1) sub-rows created by a reschedule that have no payment yet, OR
                             2) primary rows fully absorbed into future installments
                                (status overdue + remaining=0 + paid=0).
                             The server's preview endpoint enforces actual eligibility. */}
                        {(() => {
                          const remNumLocal = Number(inst.remainingAmount);
                          const paidNumLocal = Number(inst.amountPaid);
                          const isResubRow =
                            inst.rescheduledFromId &&
                            inst.parentInstallmentNumber != null &&
                            paidNumLocal === 0 &&
                            !inst.isRescheduled &&
                            (inst.status === InstallmentStatus.UPCOMING ||
                              inst.status === InstallmentStatus.DUE_TODAY ||
                              inst.status === InstallmentStatus.OVERDUE);
                          const isAbsorbedPrimary =
                            inst.parentInstallmentNumber == null &&
                            inst.status === InstallmentStatus.OVERDUE &&
                            remNumLocal === 0 &&
                            paidNumLocal === 0;
                          if (!isResubRow && !isAbsorbedPrimary) return null;
                          return (
                            <button
                              onClick={() => {
                                setUndoRescheduleTarget({
                                  installmentId: inst.id,
                                  installmentLabel: formatInstallmentLabel(inst),
                                });
                                setUndoRescheduleReason('');
                              }}
                              title="Undo the reschedule that created/affected this row"
                              className={cn(
                                'flex items-center gap-1 rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400',
                                'hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors',
                              )}
                            >
                              <Undo2 className="h-3 w-3" />
                              Undo Reschedule
                            </button>
                          );
                        })()}
                        {lastPayment && inst.status !== 'rescheduled' && (
                          <button
                            onClick={() =>
                              setRevertTarget({
                                paymentId: lastPayment.id,
                                amount: Number(lastPayment.amount),
                                installmentLabel: formatInstallmentLabel(inst),
                                installmentId: inst.id,
                                installmentNumber: inst.installmentNumber ?? null,
                                originalPaymentDate: lastPayment.paymentDate
                                  ? typeof lastPayment.paymentDate === 'string'
                                    ? lastPayment.paymentDate.split('T')[0]
                                    : new Date(lastPayment.paymentDate).toISOString().split('T')[0]
                                  : null,
                                dueDate: inst.dueDate
                                  ? typeof inst.dueDate === 'string'
                                    ? inst.dueDate.split('T')[0]
                                    : new Date(inst.dueDate).toISOString().split('T')[0]
                                  : null,
                                expectedRemainingAfterRevert:
                                  Number(inst.amountDue) -
                                  Math.max(
                                    0,
                                    Number(inst.amountPaid) - Number(lastPayment.amount),
                                  ),
                              })
                            }
                            title="Undo last payment"
                            className={cn(
                              'flex items-center gap-1 rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400',
                              'hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors',
                            )}
                          >
                            <Undo2 className="h-3 w-3" />
                            Undo
                          </button>
                        )}
                        {/* Modify — correct a payment recorded with the wrong amount */}
                        {lastPayment && inst.status === 'paid' && (
                          <button
                            onClick={() => {
                              setModifyTarget({
                                paymentId: lastPayment.id,
                                installmentId: inst.id,
                                installmentLabel: formatInstallmentLabel(inst),
                                recordedAmount: Number(lastPayment.amount),
                                amountDue: Number(inst.amountDue),
                                dueDate: inst.dueDate
                                  ? typeof inst.dueDate === 'string'
                                    ? inst.dueDate.split('T')[0]
                                    : new Date(inst.dueDate).toISOString().split('T')[0]
                                  : null,
                              });
                              setModifyCorrectAmount('');
                              setModifyReason('');
                              setModifyApplyInterest(false);
                              setModifyInterestAmount('');
                              setModifyInterestNotes('');
                            }}
                            title="Correct recorded amount"
                            className={cn(
                              'flex items-center gap-1 rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-400',
                              'hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors',
                            )}
                          >
                            <Pencil className="h-3 w-3" />
                            Modify
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {isAbsorbed ? (
                        <button
                          type="button"
                          onClick={() => toggleManual(inst.id)}
                          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          title={
                            manuallyEnabled.has(inst.id)
                              ? 'Disable manual recording for this row.'
                              : 'This installment was absorbed into future installments. Toggle on to record a missed payment manually.'
                          }
                        >
                          <span
                            className={cn(
                              'relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors',
                              manuallyEnabled.has(inst.id)
                                ? 'bg-emerald-500/70'
                                : 'bg-muted',
                            )}
                          >
                            <span
                              className={cn(
                                'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-transform',
                                manuallyEnabled.has(inst.id) ? 'left-3.5' : 'left-0.5',
                              )}
                            />
                          </span>
                          {manuallyEnabled.has(inst.id) ? 'Manual on' : 'Enable Pay'}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment dialog */}
      {paymentTarget && (
        <RecordPaymentDialog
          installmentId={paymentTarget.id}
          amountDue={paymentTarget.amount}
          initialScenario={paymentTarget.initialScenario}
          installmentNumber={paymentTarget.number}
          scheduleId={scheduleId}
          onSuccess={() => setPaymentTarget(null)}
          onClose={() => setPaymentTarget(null)}
        />
      )}

      {promiseFor && scheduleId && (
        <PromiseDialog
          scheduleId={scheduleId}
          customerId={customer.id}
          customerName={customer.name}
          installments={installments
            .filter((i: any) => i.parentInstallmentNumber == null && i.status !== InstallmentStatus.RESCHEDULED)
            .map((i: any) => ({
              id: i.id,
              installmentNumber: i.installmentNumber,
              dueDate: String(i.dueDate).slice(0, 10),
              remainingAmount: Number(i.remainingAmount),
            }))}
          defaultCoveredIds={promiseFor.length > 0 ? promiseFor : undefined}
          onClose={() => setPromiseFor(null)}
        />
      )}

      {/* Revert payment confirmation dialog */}
      {revertTarget && (() => {
        // Compute suggested overdue interest if the row's due date has passed.
        // Mirrors the server formula: monthlyRate% / 30 / day, on the
        // expected post-revert remaining balance.
        const monthlyRate = Number(sale?.interestRate ?? 0);
        let daysOverdue = 0;
        if (revertTarget.dueDate) {
          const due = new Date(revertTarget.dueDate);
          const today = new Date();
          const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
          const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
          daysOverdue = Math.max(
            0,
            Math.floor((todayDay - dueDay) / (1000 * 60 * 60 * 24)),
          );
        }
        const dailyRate = monthlyRate / 100 / 30;
        const suggestedInterest = Math.round(
          revertTarget.expectedRemainingAfterRevert * dailyRate * daysOverdue * 100,
        ) / 100;
        const closeRevert = () => {
          setRevertTarget(null);
          setRevertReason('');
          setRevertApplyInterest(false);
          setRevertInterestAmount('');
          setRevertInterestNotes('');
          setRevertCascade(true);
          setRevertMoveEnabled(false);
          setRevertMoveTargetId('');
          setRevertMovePaymentDate('');
          setRevertMoveInterestEnabled(false);
          setRevertMoveInterestAmount('');
          setRevertMoveInterestNotes('');
        };
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeRevert} />
          <div className="relative z-10 w-full max-w-4xl rounded-lg border bg-card p-6 shadow-xl mx-4 max-h-[90vh] overflow-y-auto overflow-x-hidden scrollbar-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium">Undo Payment</h3>
                <p className="text-sm text-muted-foreground">{revertTarget.installmentLabel}</p>
              </div>
              <button onClick={closeRevert} className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-6">
              {/* ── Left column: form ──────────────────────────────── */}
              <div className="space-y-4 min-w-0">

            {/* Reason — auto-generated; user can override */}
            {(() => {
              const targetInst = revertMoveEnabled && revertMoveTargetId
                ? installments.find((i: any) => i.id === revertMoveTargetId)
                : null;
              const autoReason = revertMoveEnabled && targetInst
                ? `Payment of ${formatINR(revertTarget.amount)} on installment ${revertTarget.installmentLabel} moved to installment ${formatInstallmentLabel(targetInst)}.`
                : `Reverting payment of ${formatINR(revertTarget.amount)} on installment ${revertTarget.installmentLabel}.`;
              const displayValue = revertReason || autoReason;
              const isAuto = !revertReason;
              return (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium">Reason</label>
                    {isAuto && (
                      <span className="text-xs text-muted-foreground italic">auto-generated — edit if needed</span>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={displayValue}
                    onChange={(e) => setRevertReason(e.target.value)}
                    placeholder="e.g. Wrong amount entered, wrong installment selected..."
                    className={cn(
                      'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
              );
            })()}

            {/* Optional: apply overdue interest at the same time */}
            {daysOverdue > 0 && suggestedInterest > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 p-3 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Overdue interest available
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {daysOverdue} days overdue · suggested {formatINR(suggestedInterest)}{' '}
                    on remaining {formatINR(revertTarget.expectedRemainingAfterRevert)}
                  </p>
                </div>
                <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={revertApplyInterest}
                    onChange={(e) => {
                      setRevertApplyInterest(e.target.checked);
                      if (e.target.checked && !revertInterestAmount) {
                        setRevertInterestAmount(String(suggestedInterest));
                      }
                    }}
                    className="mt-0.5 rounded border-amber-300"
                  />
                  <span>
                    Apply overdue interest along with this revert. The interest
                    will be added to the installment before it gets absorbed
                    into future installments.
                  </span>
                </label>
                {revertApplyInterest && (
                  <div className="space-y-1.5 pl-6">
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="number"
                        step="0.01"
                        value={revertInterestAmount}
                        onChange={(e) => setRevertInterestAmount(e.target.value)}
                        placeholder={String(suggestedInterest)}
                        className="flex-1 min-w-0 rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={() => setRevertInterestAmount(String(suggestedInterest))}
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        use
                      </button>
                    </div>
                    <input
                      type="text"
                      value={revertInterestNotes}
                      onChange={(e) => setRevertInterestNotes(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-full rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Distribution preview ───────────────────────────────── */}
            {(() => {
              const interestAmt = revertApplyInterest ? Number(revertInterestAmount) || 0 : 0;
              const totalToDistribute = revertTarget.expectedRemainingAfterRevert + interestAmt;
              const preview = computeDistributionPreview(totalToDistribute, revertTarget.installmentId);
              return (
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-900/30 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                  <div>
                    <span className="font-medium">After revert:</span>{' '}
                    {formatINR(totalToDistribute)} will be{' '}
                    {preview.createNew
                      ? 'placed in a new installment (due today) — no upcoming installments remain.'
                      : `distributed across ${preview.count} upcoming installment${preview.count !== 1 ? 's' : ''} (+${formatINR(preview.perRow)} each).`}
                  </div>
                </div>
              );
            })()}

            {/* ── Cascade: shift subsequent paid installments ────────── */}
            {!revertMoveEnabled && (() => {
              const srcNum = revertTarget.installmentNumber;
              if (srcNum == null) return null;
              const chain: Array<{ from: number; to: number; label: string; amount: number; paymentDate: string | null }> = [];
              let cur = srcNum + 1;
              while (true) {
                const next = installments.find(
                  (i: any) =>
                    i.installmentNumber === cur &&
                    i.parentInstallmentNumber == null &&
                    !i.isRescheduled &&
                    i.status === 'paid',
                );
                if (!next) break;
                const lastP = next.payments?.[next.payments.length - 1] ?? null;
                chain.push({
                  from: cur,
                  to: cur - 1,
                  label: formatInstallmentLabel(next),
                  amount: lastP ? Number(lastP.amount) : 0,
                  paymentDate: lastP?.paymentDate
                    ? (typeof lastP.paymentDate === 'string' ? lastP.paymentDate.split('T')[0] : new Date(lastP.paymentDate).toISOString().split('T')[0])
                    : null,
                });
                cur += 1;
              }
              if (chain.length === 0) return null;
              return (
                <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-900/40 p-3 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={revertCascade}
                      onChange={(e) => setRevertCascade(e.target.checked)}
                      className="mt-0.5 rounded border-violet-300"
                    />
                    <div>
                      <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                        Shift subsequent payments up
                      </p>
                      <p className="text-xs text-violet-700 dark:text-violet-300">
                        {chain.length} paid installment{chain.length > 1 ? 's' : ''} after #{srcNum} will shift back by one slot.
                      </p>
                    </div>
                  </label>
                  {revertCascade && (
                    <div className="pl-6 space-y-0.5">
                      {chain.map((c) => (
                        <p key={c.from} className="text-xs text-violet-800 dark:text-violet-300">
                          #{c.from} → #{c.to}{c.paymentDate ? ` (payment date: ${c.paymentDate})` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Fix Mis-record section ─────────────────────────────── */}
            {(() => {
              const moveTargetOptions = installments.filter(
                (i: any) =>
                  i.id !== revertTarget.installmentId &&
                  i.status !== 'rescheduled',
              );

              let targetSuggestedInterest = 0;
              if (revertMoveEnabled && revertMoveTargetId) {
                const targetInst = installments.find((i: any) => i.id === revertMoveTargetId);
                if (targetInst?.dueDate) {
                  const due = new Date(targetInst.dueDate);
                  const today = new Date();
                  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
                  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
                  const targetDaysOverdue = Math.max(0, Math.floor((todayDay - dueDay) / (1000 * 60 * 60 * 24)));
                  const dailyRate = Number(sale?.interestRate ?? 0) / 100 / 30;
                  targetSuggestedInterest =
                    Math.round(Number(targetInst.remainingAmount) * dailyRate * targetDaysOverdue * 100) / 100;
                }
              }

              return (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-900/40 p-3 space-y-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={revertMoveEnabled}
                      onChange={(e) => {
                        setRevertMoveEnabled(e.target.checked);
                        if (e.target.checked) {
                          setRevertMovePaymentDate(revertTarget.originalPaymentDate ?? '');
                        } else {
                          setRevertMoveTargetId('');
                          setRevertMovePaymentDate('');
                          setRevertMoveInterestEnabled(false);
                          setRevertMoveInterestAmount('');
                          setRevertMoveInterestNotes('');
                        }
                      }}
                      className="mt-0.5 rounded border-blue-300"
                    />
                    <div>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                        Fix mis-recorded payment
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Move this payment to the correct installment instead of just reverting it.
                      </p>
                    </div>
                  </label>

                  {revertMoveEnabled && (
                    <div className="space-y-3 pl-6">
                      <div>
                        <label className="block text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">
                          Move payment to installment <span className="text-destructive">*</span>
                        </label>
                        <select
                          value={revertMoveTargetId}
                          onChange={(e) => {
                            setRevertMoveTargetId(e.target.value);
                            setRevertMoveInterestEnabled(false);
                            setRevertMoveInterestAmount('');
                          }}
                          className="w-full rounded-md border bg-field px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">— Select installment —</option>
                          {moveTargetOptions.map((i: any) => (
                            <option key={i.id} value={i.id}>
                              {formatInstallmentLabel(i)} · Due {formatDateIN(i.dueDate)} · Remaining {formatINR(i.remainingAmount)}
                            </option>
                          ))}
                        </select>
                        {moveTargetOptions.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1">No eligible target installments found.</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">
                          Payment date (when customer actually paid)
                        </label>
                        <input
                          type="date"
                          value={revertMovePaymentDate}
                          onChange={(e) => setRevertMovePaymentDate(e.target.value)}
                          className="rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        {revertTarget.originalPaymentDate && (
                          <button
                            type="button"
                            onClick={() => setRevertMovePaymentDate(revertTarget.originalPaymentDate!)}
                            className="ml-2 text-xs text-primary hover:underline"
                          >
                            use original ({revertTarget.originalPaymentDate})
                          </button>
                        )}
                      </div>

                      {revertMoveTargetId && targetSuggestedInterest > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2 space-y-1.5">
                          <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={revertMoveInterestEnabled}
                              onChange={(e) => {
                                setRevertMoveInterestEnabled(e.target.checked);
                                if (e.target.checked && !revertMoveInterestAmount) {
                                  setRevertMoveInterestAmount(String(targetSuggestedInterest));
                                }
                              }}
                              className="mt-0.5 rounded border-amber-300"
                            />
                            <span>
                              Apply overdue interest on target installment · suggested {formatINR(targetSuggestedInterest)}
                            </span>
                          </label>
                          {revertMoveInterestEnabled && (
                            <div className="space-y-1 pl-5">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={revertMoveInterestAmount}
                                  onChange={(e) => setRevertMoveInterestAmount(e.target.value)}
                                  placeholder={String(targetSuggestedInterest)}
                                  className="flex-1 rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <button
                                  type="button"
                                  onClick={() => setRevertMoveInterestAmount(String(targetSuggestedInterest))}
                                  className="shrink-0 text-xs text-primary hover:underline"
                                >
                                  use
                                </button>
                              </div>
                              <input
                                type="text"
                                value={revertMoveInterestNotes}
                                onChange={(e) => setRevertMoveInterestNotes(e.target.value)}
                                placeholder="Note (optional)"
                                className="w-full rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Action buttons ─────────────────────────────────────── */}
            {revertMoveEnabled ? (
              <button
                type="button"
                disabled={!revertMoveTargetId || moveMutation.isPending}
                onClick={() => {
                  const targetInst2 = installments.find((i: any) => i.id === revertMoveTargetId);
                  const autoReasonMove = targetInst2
                    ? `Payment of ${formatINR(revertTarget.amount)} on installment ${revertTarget.installmentLabel} moved to installment ${formatInstallmentLabel(targetInst2)}.`
                    : `Payment moved from installment ${revertTarget.installmentLabel}.`;
                  const interestPayload =
                    revertMoveInterestEnabled && Number(revertMoveInterestAmount) > 0
                      ? { amount: Number(revertMoveInterestAmount), notes: revertMoveInterestNotes.trim() || undefined }
                      : undefined;
                  moveMutation.mutate(
                    {
                      paymentId: revertTarget.paymentId,
                      targetInstallmentId: revertMoveTargetId,
                      reason: revertReason.trim() || autoReasonMove,
                      paymentDate: revertMovePaymentDate || undefined,
                      applyInterestOnTarget: interestPayload,
                    },
                    { onSuccess: closeRevert },
                  );
                }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white',
                  'hover:bg-blue-700 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {moveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                Move Payment
              </button>
            ) : (
              <button
                type="button"
                disabled={revertMutation.isPending}
                onClick={() => {
                  const autoReasonRevert = `Reverting payment of ${formatINR(revertTarget.amount)} on installment ${revertTarget.installmentLabel}.`;
                  const interestPayload =
                    revertApplyInterest && Number(revertInterestAmount) > 0
                      ? { amount: Number(revertInterestAmount), notes: revertInterestNotes.trim() || undefined }
                      : undefined;
                  revertMutation.mutate(
                    {
                      paymentId: revertTarget.paymentId,
                      reason: revertReason.trim() || autoReasonRevert,
                      applyInterest: interestPayload,
                      cascade: revertCascade,
                    },
                    { onSuccess: closeRevert },
                  );
                }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 rounded-md bg-red-600 px-5 py-2.5 text-sm font-medium text-white',
                  'hover:bg-red-700 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {revertMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                Confirm Undo
              </button>
            )}

              </div>{/* end left column */}

              {/* ── Right column: summary sidebar ──────────────────── */}
              <aside className="space-y-3 min-w-0">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Summary</p>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Installment</dt>
                      <dd className="font-medium">{revertTarget.installmentLabel}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Payment recorded</dt>
                      <dd className="font-medium">{formatINR(revertTarget.amount)}</dd>
                    </div>
                    {revertTarget.dueDate && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Due date</dt>
                        <dd className="font-medium">{formatDateIN(revertTarget.dueDate)}</dd>
                      </div>
                    )}
                    {revertTarget.originalPaymentDate && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Paid on</dt>
                        <dd className="font-medium">{formatDateIN(revertTarget.originalPaymentDate)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1.5 mt-1.5">
                      <dt className="text-muted-foreground">Balance after revert</dt>
                      <dd className="font-semibold text-red-600">
                        {formatINR(
                          revertTarget.expectedRemainingAfterRevert +
                            (revertApplyInterest ? Number(revertInterestAmount) || 0 : 0),
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 p-3">
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    This action will restore the installment balance and log the reversal in the activity timeline.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeRevert}
                  className="w-full rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </aside>
            </div>{/* end grid */}
          </div>
        </div>
        );
      })()}

      {/* ── Modify (correct wrong amount) dialog ─────────────────────────── */}
      {modifyTarget && (() => {
        const shortfall = Math.max(0, modifyTarget.recordedAmount - (Number(modifyCorrectAmount) || 0));
        const hasValidCorrect = Number(modifyCorrectAmount) > 0 && Number(modifyCorrectAmount) < modifyTarget.recordedAmount;

        // Suggested interest on the shortfall (from installment due date → today)
        let suggestedInterestOnShortfall = 0;
        if (shortfall > 0 && modifyTarget.dueDate) {
          const due = new Date(modifyTarget.dueDate);
          const today = new Date();
          const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
          const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
          const daysOverdue = Math.max(0, Math.floor((todayDay - dueDay) / (1000 * 60 * 60 * 24)));
          const dailyRate = Number(sale?.interestRate ?? 0) / 100 / 30;
          suggestedInterestOnShortfall = Math.round(shortfall * dailyRate * daysOverdue * 100) / 100;
        }

        const interestAmt = modifyApplyInterest ? Number(modifyInterestAmount) || 0 : 0;
        const totalToDistribute = shortfall + interestAmt;
        const preview = hasValidCorrect
          ? computeDistributionPreview(totalToDistribute, modifyTarget.installmentId)
          : null;

        const closeModify = () => {
          setModifyTarget(null);
          setModifyCorrectAmount('');
          setModifyReason('');
          setModifyApplyInterest(false);
          setModifyInterestAmount('');
          setModifyInterestNotes('');
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={closeModify} />
            <div className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl mx-4 max-h-[90vh] overflow-y-auto scrollbar-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-orange-600">Modify Payment</h3>
                <button onClick={closeModify} className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Context */}
              <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Installment</span>
                  <span className="font-medium">{modifyTarget.installmentLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recorded amount</span>
                  <span className="font-semibold text-foreground">{formatINR(modifyTarget.recordedAmount)}</span>
                </div>
              </div>

              {/* Correct amount input */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1.5">
                  Actual amount received <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={modifyCorrectAmount}
                  onChange={(e) => {
                    setModifyCorrectAmount(e.target.value);
                    setModifyApplyInterest(false);
                    setModifyInterestAmount('');
                  }}
                  placeholder={`Must be less than ${formatINR(modifyTarget.recordedAmount)}`}
                  className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {hasValidCorrect && (
                  <p className="mt-1 text-xs text-orange-600 font-medium">
                    Shortfall: {formatINR(shortfall)}
                  </p>
                )}
                {modifyCorrectAmount && !hasValidCorrect && (
                  <p className="mt-1 text-xs text-destructive">
                    Must be a positive number less than {formatINR(modifyTarget.recordedAmount)}.
                  </p>
                )}
              </div>

              {/* Distribution preview */}
              {hasValidCorrect && (() => {
                const isPartial = Number(modifyCorrectAmount) < modifyTarget.amountDue;
                if (isPartial) {
                  const interestAmt2 = modifyApplyInterest ? Number(modifyInterestAmount) || 0 : 0;
                  const newAmountDue = modifyTarget.amountDue + interestAmt2;
                  const newRemaining = newAmountDue - Number(modifyCorrectAmount);
                  return (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-900/30 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                      <div>
                        <span className="font-medium">Shortfall stays here:</span>{' '}
                        {formatINR(newRemaining)} will remain on installment {modifyTarget.installmentLabel} (status → Partially Paid).
                      </div>
                    </div>
                  );
                }
                if (!preview) return null;
                return (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-900/30 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <div>
                      <span className="font-medium">Distribution:</span>{' '}
                      {formatINR(totalToDistribute)} will be{' '}
                      {preview.createNew
                        ? 'placed in a new installment (due today) — no upcoming installments remain.'
                        : `split across ${preview.count} upcoming installment${preview.count !== 1 ? 's' : ''} (+${formatINR(preview.perRow)} each).`}
                    </div>
                  </div>
                );
              })()}

              {/* Optional interest on shortfall */}
              {hasValidCorrect && suggestedInterestOnShortfall > 0 && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 p-3 space-y-2">
                  <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                      Overdue interest on shortfall
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Suggested {formatINR(suggestedInterestOnShortfall)} on shortfall of {formatINR(shortfall)} from due date to today.
                    </p>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modifyApplyInterest}
                      onChange={(e) => {
                        setModifyApplyInterest(e.target.checked);
                        if (e.target.checked && !modifyInterestAmount) {
                          setModifyInterestAmount(String(suggestedInterestOnShortfall));
                        }
                      }}
                      className="mt-0.5 rounded border-amber-300"
                    />
                    <span>Include interest in the distributed amount</span>
                  </label>
                  {modifyApplyInterest && (
                    <div className="space-y-1.5 pl-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={modifyInterestAmount}
                          onChange={(e) => setModifyInterestAmount(e.target.value)}
                          placeholder={String(suggestedInterestOnShortfall)}
                          className="flex-1 rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={() => setModifyInterestAmount(String(suggestedInterestOnShortfall))}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          use
                        </button>
                      </div>
                      <input
                        type="text"
                        value={modifyInterestNotes}
                        onChange={(e) => setModifyInterestNotes(e.target.value)}
                        placeholder="Note (optional)"
                        className="w-full rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Reason — auto-generated from amounts; user can override */}
              {(() => {
                const interestPart =
                  modifyApplyInterest && Number(modifyInterestAmount) > 0
                    ? ` Overdue interest of ${formatINR(Number(modifyInterestAmount))} applied on shortfall.`
                    : '';
                const autoReason = hasValidCorrect
                  ? `Customer paid ${formatINR(Number(modifyCorrectAmount))} but ${formatINR(modifyTarget.recordedAmount)} was recorded for installment ${modifyTarget.installmentLabel}.${interestPart}`
                  : '';
                const displayValue = modifyReason || autoReason;
                const isAuto = !!autoReason && !modifyReason;
                return (
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-medium">Reason</label>
                      {isAuto && (
                        <span className="text-xs text-muted-foreground italic">auto-generated — edit if needed</span>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      value={displayValue}
                      onChange={(e) => setModifyReason(e.target.value)}
                      placeholder="e.g. Customer paid ₹3,000 but ₹5,000 was recorded by mistake."
                      className="w-full rounded-md border bg-field px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    />
                  </div>
                );
              })()}

              <div className="flex justify-end gap-3">
                <button onClick={closeModify} className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button
                  disabled={!hasValidCorrect || correctMutation.isPending}
                  onClick={() => {
                    const interestPart =
                      modifyApplyInterest && Number(modifyInterestAmount) > 0
                        ? ` Overdue interest of ${formatINR(Number(modifyInterestAmount))} applied on shortfall.`
                        : '';
                    const autoReason = `Customer paid ${formatINR(Number(modifyCorrectAmount))} but ${formatINR(modifyTarget.recordedAmount)} was recorded for installment ${modifyTarget.installmentLabel}.${interestPart}`;
                    const interestPayload =
                      modifyApplyInterest && Number(modifyInterestAmount) > 0
                        ? {
                            amount: Number(modifyInterestAmount),
                            notes: modifyInterestNotes.trim() || undefined,
                          }
                        : undefined;
                    correctMutation.mutate(
                      {
                        paymentId: modifyTarget.paymentId,
                        correctAmount: Number(modifyCorrectAmount),
                        reason: modifyReason.trim() || autoReason,
                        applyInterest: interestPayload,
                      },
                      { onSuccess: closeModify },
                    );
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white',
                    'hover:bg-orange-700 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {correctMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Correcting...</>
                  ) : (
                    <><Pencil className="h-4 w-4" /> Correct Payment</>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Undo Reschedule dialog ─────────────────────────────────────── */}
      {undoRescheduleTarget && (() => {
        const closeUndoResched = () => {
          setUndoRescheduleTarget(null);
          setUndoRescheduleReason('');
        };
        const preview = undoReschedulePreviewQuery.data;
        const isLoading = undoReschedulePreviewQuery.isLoading;
        const isError = undoReschedulePreviewQuery.isError;
        const eligible = !!preview && preview.eligible;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={closeUndoResched} />
            <div className="relative z-10 w-full max-w-2xl rounded-lg border bg-card p-6 shadow-xl mx-4 max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-medium">Undo Reschedule</h3>
                  <p className="text-sm text-muted-foreground">
                    Installment {undoRescheduleTarget.installmentLabel}
                  </p>
                </div>
                <button
                  onClick={closeUndoResched}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              {isError && (
                <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
                  Failed to load undo preview. Please close the dialog and try again.
                </div>
              )}

              {preview && preview.eligible === false && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium mb-1">Undo is not available for this installment.</p>
                      <p>{preview.reason}</p>
                    </div>
                  </div>
                </div>
              )}

              {preview && preview.eligible && preview.branch === 'sub_row' && (
                <div className="space-y-4">
                  <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2">
                    <p className="font-medium">This will:</p>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      <li>
                        Delete the rescheduled sub-row{' '}
                        <span className="font-medium text-foreground">{preview.subRowLabel}</span>{' '}
                        due {formatDateIN(preview.newDueDate)} ({formatINR(preview.amount)}).
                      </li>
                      <li>
                        Restore installment{' '}
                        <span className="font-medium text-foreground">{preview.sourceLabel}</span>{' '}
                        (originally due {formatDateIN(preview.sourceDueDate)}) with the full{' '}
                        {formatINR(preview.amount)} owed again.
                      </li>
                      <li>Log the undo action in the activity timeline.</li>
                    </ul>
                    {preview.rescheduledBy && preview.rescheduledAt && (
                      <p className="pt-2 text-xs text-muted-foreground">
                        Original reschedule by <span className="font-medium">{preview.rescheduledBy}</span>{' '}
                        on {formatDateIN(preview.rescheduledAt)}.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {preview && preview.eligible && preview.branch === 'redistribute' && (
                <div className="space-y-4">
                  <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2">
                    <p className="font-medium">This will:</p>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      <li>
                        Restore {formatINR(preview.carryover)} of obligation onto installment{' '}
                        <span className="font-medium text-foreground">#{preview.restoresPrimaryNumber}</span>.
                      </li>
                      <li>
                        Reverse the redistribution across {preview.targets.length} future installment
                        {preview.targets.length === 1 ? '' : 's'}:
                      </li>
                    </ul>
                    <div className="mt-2 rounded-md border bg-background overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium">EMI</th>
                            <th className="px-2 py-1.5 text-right font-medium">Current Due</th>
                            <th className="px-2 py-1.5 text-right font-medium">Decrease</th>
                            <th className="px-2 py-1.5 text-right font-medium">New Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.targets.map((t) => (
                            <tr key={t.id} className="border-t last:border-0">
                              <td className="px-2 py-1.5">#{t.installmentNumber}</td>
                              <td className="px-2 py-1.5 text-right">{formatINR(t.currentAmountDue)}</td>
                              <td className="px-2 py-1.5 text-right text-amber-600">
                                −{formatINR(t.delta)}
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium">
                                {formatINR(t.newAmountDue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {preview.rescheduledBy && preview.rescheduledAt && (
                      <p className="pt-2 text-xs text-muted-foreground">
                        Original reschedule by <span className="font-medium">{preview.rescheduledBy}</span>{' '}
                        on {formatDateIN(preview.rescheduledAt)} (promised{' '}
                        {preview.promisedDate ? formatDateIN(preview.promisedDate) : 'n/a'}).
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Reason input — only when eligible */}
              {eligible && (
                <div className="mt-4">
                  <label className="block text-sm font-medium mb-1.5">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={undoRescheduleReason}
                    onChange={(e) => setUndoRescheduleReason(e.target.value)}
                    placeholder="e.g. Reschedule was created by mistake"
                    className={cn(
                      'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                      'placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                  />
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t">
                <button
                  onClick={closeUndoResched}
                  className="rounded-md border bg-field px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                {eligible && (
                  <button
                    disabled={
                      undoRescheduleMutation.isPending ||
                      !undoRescheduleReason.trim()
                    }
                    onClick={() => {
                      undoRescheduleMutation.mutate(
                        {
                          installmentId: undoRescheduleTarget.installmentId,
                          reason: undoRescheduleReason.trim(),
                        },
                        { onSuccess: closeUndoResched },
                      );
                    }}
                    className={cn(
                      'flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white',
                      'hover:bg-red-700 transition-colors',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    {undoRescheduleMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Undoing...</>
                    ) : (
                      <><Undo2 className="h-4 w-4" /> Confirm Undo</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
/**
 * Late-penalty rate for this sale, editable in place. A change applies to
 * penalty charged from now on — charges already made keep the rate they used.
 */
function PenaltyRateRow({
  scheduleId,
  perDay,
  isDefault,
}: {
  scheduleId: string;
  perDay: number;
  isDefault: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(perDay));
  const mutation = useUpdatePenaltyPerDayMutation();
  const addToast = useToastStore((s) => s.addToast);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 10000;

  const save = () => {
    if (!valid) return;
    mutation.mutate(
      { scheduleId, penaltyPerDay: Math.round(parsed * 100) / 100 },
      {
        onSuccess: () => {
          addToast({ type: 'success', message: `Late penalty set to ${formatINR(parsed)} per day` });
          setEditing(false);
        },
        onError: (err: unknown) =>
          addToast({
            type: 'error',
            message:
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              'Could not update the penalty rate',
          }),
      },
    );
  };

  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">Late penalty</dt>
      {editing ? (
        <dd className="mt-0.5 flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">₹</span>
          <input
            id="penalty-per-day"
            type="number"
            min={0}
            step="0.5"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-invalid={!valid || undefined}
            aria-label="Late penalty in rupees per day"
            className="h-8 w-20 rounded-md border border-input bg-field px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/25"
          />
          <span className="text-sm text-muted-foreground">/ day</span>
          <button
            type="button"
            onClick={save}
            disabled={!valid || mutation.isPending}
            className="ml-1 text-sm font-medium text-primary hover:underline disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(String(perDay));
              setEditing(false);
            }}
            className="text-sm text-muted-foreground hover:underline"
          >
            Cancel
          </button>
        </dd>
      ) : (
        <dd className="mt-0.5 flex items-center gap-2 text-sm">
          <span>
            {formatINR(perDay)} / day while any EMI is late
            {isDefault && <span className="text-muted-foreground"> (shop default)</span>}
          </span>
          <button
            type="button"
            onClick={() => {
              setValue(String(perDay));
              setEditing(true);
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Edit
          </button>
        </dd>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
