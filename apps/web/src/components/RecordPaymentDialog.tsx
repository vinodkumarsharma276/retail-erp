import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle,
  CalendarClock,
  ArrowRightLeft,
  Undo2,
  Info,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useRecordInstallmentPaymentMutation,
  useInterestAccrualQuery,
  useRollbackInterestApplicationMutation,
  useSettlementQuoteQuery,
} from '../hooks/useInstallments';
import { formatINR } from '@retailerp/shared-utils';
import { PaymentMode } from '@retailerp/shared-types';
import { useCanCheck } from '../hooks/usePermission';
import { useToastStore } from '../stores/toast-store';
import { DateInput } from './DateInput';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface RecordPaymentDialogProps {
  installmentId: string;
  amountDue: number;
  installmentNumber?: number;
  defaultDate?: string; // ISO date string for the installment due date
  initialScenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
  /**
   * Pass the schedule id to enable the overdue-interest accrual banner —
   * dialog will fetch suggested + applied interest for this installment.
   */
  scheduleId?: string;
  onSuccess: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Payment mode options
// ---------------------------------------------------------------------------
const paymentModes = [
  { value: PaymentMode.CASH, label: 'Cash' },
  { value: PaymentMode.CREDIT_CARD, label: 'Credit Card' },
  { value: PaymentMode.DEBIT_CARD, label: 'Debit Card' },
  { value: PaymentMode.UPI, label: 'UPI' },
] as const;

type Scenario = 'full_payment' | 'reschedule' | 'partial_reschedule';

interface Split {
  mode: PaymentMode;
  amount: number | '';
}

function sumSplits(splits: Split[]): number {
  return splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RecordPaymentDialog({
  installmentId,
  amountDue,
  installmentNumber,
  defaultDate,
  initialScenario = 'full_payment',
  scheduleId,
  onSuccess,
  onClose,
}: RecordPaymentDialogProps) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const can = useCanCheck();
  const addToast = useToastStore((s) => s.addToast);

  // Overdue interest accrual (optional — only when scheduleId provided)
  const { data: accrualList } = useInterestAccrualQuery(scheduleId, !!scheduleId);
  const accrualForRow = accrualList?.find((a) => a.installmentId === installmentId) ?? null;
  const activeApp = accrualForRow?.applications?.[0] ?? null;
  const rollbackInterestMutation = useRollbackInterestApplicationMutation();
  const canApplyInterest = can('installments.interest.apply');
  const canRollbackInterest = can('installments.interest.rollback');

  // Settlement quote — for prepayment preview (excess waiver)
  const { data: settlementQuote } = useSettlementQuoteQuery(scheduleId, !!scheduleId);

  // Client-side discretionary interest selection (NOT yet committed to DB).
  // Will be sent as part of the payment payload so the API applies it
  // atomically. If user closes the dialog without recording payment, no
  // server-side change is made.
  const [includeInterest, setIncludeInterest] = useState<boolean>(false);
  const [interestAmount, setInterestAmount] = useState<string>('');
  const [interestNotes, setInterestNotes] = useState<string>('');
  const [rollbackReason, setRollbackReason] = useState<string>('');
  // Excess-payment interest waiver toggle. Off by default: legacy behavior
  // (excess just decrements future installments). When on, the API waives
  // baked-in interest on every future installment the excess fully clears.
  const [waiveExcessInterest, setWaiveExcessInterest] = useState<boolean>(false);

  // Seed interest amount when accrual becomes available
  useEffect(() => {
    if (accrualForRow && accrualForRow.daysOverdue > 0 && interestAmount === '') {
      setInterestAmount(String(accrualForRow.suggestedInterest));
    }
  }, [accrualForRow, interestAmount]);

  const interestNum =
    includeInterest && Number(interestAmount) > 0 ? Number(interestAmount) : 0;
  // Coerce defensively — Prisma Decimal columns serialise to strings, and
  // some call sites forward `inst.remainingAmount` directly without
  // wrapping in Number(). String + number triggers JS string concat
  // (`"2860" + 0 = "28600"`) so we normalise once here.
  const amountDueNum = Number(amountDue) || 0;
  const effectiveAmountDue = useMemo(() => {
    return Math.round((amountDueNum + interestNum) * 100) / 100;
  }, [amountDueNum, interestNum]);

  // Full payment state
  const [fullAmount, setFullAmount] = useState<string>(String(amountDueNum));
  const [fullSplits, setFullSplits] = useState<Split[]>([
    { mode: PaymentMode.CASH, amount: '' },
  ]);
  const [fullDate, setFullDate] = useState<string>(defaultDate || todayStr);
  const [fullNotes, setFullNotes] = useState('');
  const [earlyCollectionDate, setEarlyCollectionDate] = useState('');
  // Tracks whether the user has manually edited fullAmount; while false we
  // keep mirroring effectiveAmountDue (base + selected interest).
  const [fullAmountTouched, setFullAmountTouched] = useState(false);

  useEffect(() => {
    if (fullAmountTouched) return;
    setFullAmount(String(effectiveAmountDue));
  }, [effectiveAmountDue, fullAmountTouched]);

  // Reschedule state
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  // Partial + reschedule state
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [partialSplits, setPartialSplits] = useState<Split[]>([
    { mode: PaymentMode.CASH, amount: '' },
  ]);
  const [partialDate, setPartialDate] = useState('');
  const [partialNotes, setPartialNotes] = useState('');

  const mutation = useRecordInstallmentPaymentMutation();

  const partialRemaining = effectiveAmountDue - (Number(partialAmount) || 0);

  // Splits-aware validity. The split sum must equal the entered amount
  // (within ₹0.50). When only one split exists we send a single paymentMode
  // (no breakdown) for backward compatibility.
  const fullSplitSum = sumSplits(fullSplits);
  const fullSplitsValid =
    fullSplits.length === 1
      ? true
      : fullSplits.every((s) => Number(s.amount) > 0) &&
        Math.abs(fullSplitSum - Number(fullAmount)) <= 0.5;
  const partialSplitSum = sumSplits(partialSplits);
  const partialSplitsValid =
    partialSplits.length === 1
      ? true
      : partialSplits.every((s) => Number(s.amount) > 0) &&
        Math.abs(partialSplitSum - Number(partialAmount)) <= 0.5;

  // Validation
  // When amountDue === 0 (e.g. an absorbed-overdue row that the user has
  // manually re-enabled), accept any positive payment — the server will
  // treat the entire amount as overpayment and distribute it via R7.
  const isFullValid =
    effectiveAmountDue > 0
      ? Number(fullAmount) >= effectiveAmountDue && fullSplitsValid
      : Number(fullAmount) > 0 && fullSplitsValid;
  const isRescheduleValid = !!rescheduleDate;
  const isPartialValid =
    Number(partialAmount) > 0 &&
    (effectiveAmountDue === 0 || Number(partialAmount) < effectiveAmountDue) &&
    !!partialDate &&
    partialSplitsValid;

  /** Build the multi-mode breakdown payload from a Split[] state. */
  const buildBreakdown = (
    splits: Split[],
    fallbackTotal: number,
  ): Array<{ mode: string; amount: number }> | undefined => {
    if (splits.length <= 1) return undefined;
    return splits.map((s, i) => {
      // For the last split, use the residue so the sum is exact even with
      // user rounding. The validation guarantees the residue is positive.
      const otherSum = splits
        .slice(0, splits.length - 1)
        .reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
      const amount =
        i === splits.length - 1
          ? Math.round((fallbackTotal - otherSum) * 100) / 100
          : Number(s.amount);
      return { mode: s.mode, amount };
    });
  };

  const handleSubmit = () => {
    let payload: {
      scenario: Scenario;
      amountPaid?: number;
      paymentMode?: string;
      paymentBreakdown?: Array<{ mode: string; amount: number }>;
      paymentDate?: string;
      newDate?: string;
      notes?: string;
      earlyCollectionDate?: string;
      applyInterest?: { amount: number; notes?: string };
      waiveExcessInterest?: boolean;
    };

    const interestPayload =
      includeInterest && interestNum > 0
        ? { amount: interestNum, notes: interestNotes.trim() || undefined }
        : undefined;

    if (scenario === 'full_payment') {
      const breakdown = buildBreakdown(fullSplits, Number(fullAmount));
      payload = {
        scenario: 'full_payment',
        amountPaid: Number(fullAmount),
        paymentMode: breakdown ? breakdown[0].mode : fullSplits[0].mode,
        paymentBreakdown: breakdown,
        paymentDate: fullDate || undefined,
        notes: fullNotes.trim() || undefined,
        earlyCollectionDate: earlyCollectionDate || undefined,
        applyInterest: interestPayload,
        waiveExcessInterest:
          Number(fullAmount) > effectiveAmountDue ? waiveExcessInterest : undefined,
      };
    } else if (scenario === 'reschedule') {
      payload = {
        scenario: 'reschedule',
        newDate: rescheduleDate,
        notes: rescheduleNotes.trim() || undefined,
      };
    } else {
      const breakdown = buildBreakdown(partialSplits, Number(partialAmount));
      payload = {
        scenario: 'partial_reschedule',
        amountPaid: Number(partialAmount),
        paymentMode: breakdown ? breakdown[0].mode : partialSplits[0].mode,
        paymentBreakdown: breakdown,
        newDate: partialDate,
        notes: partialNotes.trim() || undefined,
        applyInterest: interestPayload,
      };
    }

    mutation.mutate(
      { installmentId, payload },
      {
        onSuccess: () => {
          onSuccess();
          onClose();
        },
      },
    );
  };

  const mutationError = mutation.error
    ? (mutation.error as any)?.response?.data?.error ??
      (mutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  const tabs: { key: Scenario; label: string; icon: React.ReactNode }[] = [
    {
      key: 'full_payment',
      label: 'Full Payment',
      icon: <CheckCircle className="h-4 w-4" />,
    },
    {
      key: 'reschedule',
      label: 'Reschedule',
      icon: <CalendarClock className="h-4 w-4" />,
    },
    {
      key: 'partial_reschedule',
      label: 'Partial + Reschedule',
      icon: <ArrowRightLeft className="h-4 w-4" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-4xl rounded-lg border bg-card p-6 shadow-xl mx-4 max-h-[90vh] overflow-y-auto overflow-x-hidden scrollbar-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium">Record Payment</h3>
            {installmentNumber && (
              <p className="text-sm text-muted-foreground">
                EMI #{installmentNumber}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-muted p-1 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setScenario(tab.key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                scenario === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Two-column layout: form on the left, contextual summary on the right */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-6">
          <div className="space-y-4 min-w-0">

        {/* Full Payment Tab */}
        {scenario === 'full_payment' && (
          <div className="space-y-4">
            {/* Amount */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Amount <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={fullAmount}
                onChange={(e) => {
                  setFullAmountTouched(true);
                  setFullAmount(e.target.value);
                }}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              {Number(fullAmount) > effectiveAmountDue && (
                <PrepaymentPreview
                  excess={Number(fullAmount) - effectiveAmountDue}
                  quote={settlementQuote ?? null}
                  waiveInterest={waiveExcessInterest}
                  onWaiveChange={setWaiveExcessInterest}
                />
              )}
              {fullAmountTouched && (
                <button
                  type="button"
                  onClick={() => {
                    setFullAmountTouched(false);
                    setFullAmount(String(effectiveAmountDue));
                  }}
                  className="mt-1.5 text-xs text-primary hover:underline"
                >
                  Reset to amount due ({formatINR(effectiveAmountDue)})
                </button>
              )}
            </div>

            {/* Payment Date */}
            <div className="max-w-xs">
              <label className="block text-sm font-medium mb-1.5">
                Payment Date <span className="text-destructive">*</span>
              </label>
              <DateInput
                value={fullDate}
                onChange={(v) => setFullDate(v)}
              />
            </div>

            {/* Payment Mode (multi-split) — full width so the editor doesn't overflow */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Payment Mode <span className="text-destructive">*</span>
              </label>
              <PaymentSplitsEditor
                splits={fullSplits}
                onChange={setFullSplits}
                total={Number(fullAmount) || 0}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Notes
              </label>
              <textarea
                rows={2}
                value={fullNotes}
                onChange={(e) => setFullNotes(e.target.value)}
                placeholder="Optional payment notes..."
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Early Collection Date for Next Installment */}
            <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3">
              <label className="block text-sm font-medium mb-1.5 text-blue-800 dark:text-blue-200">
                Early Collection Date (Next Installment)
              </label>
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                If the customer wants to pay the next installment before its due date, set the preferred date here.
              </p>
              <DateInput
                value={earlyCollectionDate}
                onChange={(v) => setEarlyCollectionDate(v)}
              />
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isFullValid || mutation.isPending}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-md bg-green-600 px-5 py-2.5 text-sm font-medium text-white',
                'hover:bg-green-700 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Confirm Payment
            </button>
          </div>
        )}

        {/* Reschedule Tab */}
        {scenario === 'reschedule' && (
          <div className="space-y-4">
            {/* New Date */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                New Date <span className="text-destructive">*</span>
              </label>
              <DateInput
                value={rescheduleDate}
                onChange={(v) => setRescheduleDate(v)}
              />
              {rescheduleDate && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Installment will be moved to{' '}
                  {new Date(rescheduleDate).toLocaleDateString('en-IN', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Reason / Notes
              </label>
              <textarea
                rows={2}
                value={rescheduleNotes}
                onChange={(e) => setRescheduleNotes(e.target.value)}
                placeholder="Reason for rescheduling..."
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isRescheduleValid || mutation.isPending}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-md bg-amber-600 px-5 py-2.5 text-sm font-medium text-white',
                'hover:bg-amber-700 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarClock className="h-4 w-4" />
              )}
              Confirm Reschedule
            </button>
          </div>
        )}

        {/* Partial + Reschedule Tab */}
        {scenario === 'partial_reschedule' && (
          <div className="space-y-4">
            {/* Amount Paid */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Amount Paid <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              {Number(partialAmount) >= effectiveAmountDue && (
                <p className="mt-1 text-xs text-destructive">
                  Amount must be less than {formatINR(effectiveAmountDue)}
                </p>
              )}
            </div>

            {/* Payment Mode (multi-split) */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Payment Mode <span className="text-destructive">*</span>
              </label>
              <PaymentSplitsEditor
                splits={partialSplits}
                onChange={setPartialSplits}
                total={Number(partialAmount) || 0}
              />
            </div>

            {/* Remaining Amount */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Remaining Amount
              </label>
              <div className="w-full rounded-md border bg-muted/50 px-3 py-2.5 text-sm font-medium">
                {formatINR(partialRemaining > 0 ? partialRemaining : 0)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                This amount will be rescheduled to the new date
              </p>
            </div>

            {/* New Date for remaining */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                New Date for Remaining <span className="text-destructive">*</span>
              </label>
              <DateInput
                value={partialDate}
                onChange={(v) => setPartialDate(v)}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Notes
              </label>
              <textarea
                rows={2}
                value={partialNotes}
                onChange={(e) => setPartialNotes(e.target.value)}
                placeholder="Optional notes..."
                className={cn(
                  'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isPartialValid || mutation.isPending}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4" />
              )}
              Confirm Partial Payment
            </button>
          </div>
        )}

        {/* Error display */}
        {mutationError && (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {mutationError}
          </div>
        )}
          </div>

          {/* Right column — contextual summary + overdue interest */}
          <aside className="space-y-3 min-w-0">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Summary
              </p>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Amount due</dt>
                  <dd className="font-medium">{formatINR(amountDueNum)}</dd>
                </div>
                {includeInterest && interestNum > 0 && (
                  <div className="flex justify-between text-amber-700 dark:text-amber-400">
                    <dt>+ Overdue interest</dt>
                    <dd className="font-medium">{formatINR(interestNum)}</dd>
                  </div>
                )}
                {(includeInterest && interestNum > 0) && (
                  <div className="flex justify-between border-t pt-1.5 mt-1.5">
                    <dt className="text-muted-foreground">Total payable</dt>
                    <dd className="font-semibold">{formatINR(effectiveAmountDue)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Overdue interest accrual banner — moved into the sidebar */}
            {accrualForRow && accrualForRow.daysOverdue > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 p-3 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Overdue interest accrued
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {accrualForRow.daysOverdue} days overdue · suggested{' '}
                    {formatINR(accrualForRow.suggestedInterest)}
                  </p>
                </div>

                {activeApp && (
                  <div className="rounded-md bg-amber-100 dark:bg-amber-900/40 px-3 py-2">
                    <p className="text-xs text-amber-900 dark:text-amber-200 mb-2">
                      Already applied earlier:{' '}
                      <span className="font-semibold">
                        {formatINR(Number(activeApp.appliedAmount))}
                      </span>
                    </p>
                    {canRollbackInterest && (
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          value={rollbackReason}
                          onChange={(e) => setRollbackReason(e.target.value)}
                          placeholder="Reason to roll back…"
                          className="w-full rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <button
                          type="button"
                          disabled={!rollbackReason.trim() || rollbackInterestMutation.isPending}
                          onClick={() => {
                            rollbackInterestMutation.mutate(
                              { applicationId: activeApp.id, reason: rollbackReason.trim() },
                              {
                                onSuccess: () => {
                                  addToast({ type: 'success', message: 'Interest rolled back' });
                                  setRollbackReason('');
                                },
                                onError: (err: unknown) => {
                                  const msg =
                                    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
                                    'Failed to roll back';
                                  addToast({ type: 'error', message: msg });
                                },
                              },
                            );
                          }}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
                            'border-amber-300 bg-background hover:bg-amber-50 dark:hover:bg-amber-900/40 transition-colors',
                            'disabled:opacity-60',
                          )}
                        >
                          {rollbackInterestMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Undo2 className="h-3 w-3" />
                          )}
                          Roll back
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {canApplyInterest && (
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeInterest}
                        onChange={(e) => setIncludeInterest(e.target.checked)}
                        className="mt-0.5 rounded border-amber-300"
                      />
                      <span>
                        Add interest to this payment. Interest will only be charged
                        when you record the payment — closing the dialog discards the
                        selection.
                      </span>
                    </label>
                    {includeInterest && (
                      <div className="space-y-1.5 pl-6">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="number"
                            step="0.01"
                            value={interestAmount}
                            onChange={(e) => setInterestAmount(e.target.value)}
                            placeholder={String(accrualForRow.suggestedInterest)}
                            className="flex-1 min-w-0 rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                          <button
                            type="button"
                            onClick={() => setInterestAmount(String(accrualForRow.suggestedInterest))}
                            className="shrink-0 text-xs text-primary hover:underline"
                          >
                            use
                          </button>
                        </div>
                        <input
                          type="text"
                          value={interestNotes}
                          onChange={(e) => setInterestNotes(e.target.value)}
                          placeholder="Note (optional)"
                          className="w-full rounded-md border bg-field px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * Live preview of how an excess payment (above the current installment dues)
 * will be applied to future installments.
 *
 * Two modes (controlled by `waiveInterest`):
 *  - OFF (default): the excess is just decremented from upcoming
 *    installments. Customer still owes baked-in interest on each.
 *  - ON: every future installment fully cleared by the excess waives its
 *    baked-in interest share — same logic as the final-settlement quote.
 */
function PrepaymentPreview({
  excess,
  quote,
  waiveInterest,
  onWaiveChange,
}: {
  excess: number;
  quote: {
    perInstallment: { principalShare: number; interestShare: number; fileChargeShare: number };
    unpaidCount: number;
  } | null;
  waiveInterest: boolean;
  onWaiveChange: (next: boolean) => void;
}) {
  if (excess <= 0) return null;

  const futureUnpaid = quote ? Math.max(0, quote.unpaidCount - 1) : 0;
  const principalShare = quote?.perInstallment.principalShare ?? 0;
  const interestShare = quote?.perInstallment.interestShare ?? 0;
  const fileChargeShare = quote?.perInstallment.fileChargeShare ?? 0;
  const noInterestEmi = principalShare + fileChargeShare;
  const flatEmi = noInterestEmi + interestShare;

  // Simulation A — without waiver (legacy): excess straight-decrement.
  let remA = excess;
  let clearedA = 0;
  let principalReducedA = 0;
  if (quote && futureUnpaid > 0 && flatEmi > 0) {
    while (clearedA < futureUnpaid && remA >= flatEmi - 0.005) {
      remA = Math.round((remA - flatEmi) * 100) / 100;
      clearedA += 1;
    }
    principalReducedA = Math.round(remA * 100) / 100;
  }

  // Simulation B — with waiver: principal+file only per cleared row.
  let remB = excess;
  let clearedB = 0;
  let waivedInterestB = 0;
  if (quote && futureUnpaid > 0 && noInterestEmi > 0) {
    while (clearedB < futureUnpaid && remB >= noInterestEmi - 0.005) {
      remB = Math.round((remB - noInterestEmi) * 100) / 100;
      clearedB += 1;
      waivedInterestB = Math.round((waivedInterestB + interestShare) * 100) / 100;
    }
  }

  return (
    <div className="mt-1.5 space-y-2">
      <div className="rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900 dark:text-blue-200 space-y-0.5">
            <p>
              Excess of{' '}
              <span className="font-semibold">{formatINR(excess)}</span> applied as
              prepayment.
            </p>
            {!quote || futureUnpaid === 0 ? (
              <p>No upcoming installments to absorb the excess.</p>
            ) : !waiveInterest ? (
              <>
                {clearedA > 0 && (
                  <p>
                    Closes next {clearedA} installment{clearedA > 1 ? 's' : ''} (interest
                    NOT waived — customer still pays the original interest).
                  </p>
                )}
                {principalReducedA > 0.005 && (
                  <p>
                    Remaining{' '}
                    <span className="font-semibold">{formatINR(principalReducedA)}</span>{' '}
                    reduces the next unpaid installment.
                  </p>
                )}
                {clearedA === 0 && principalReducedA === 0 && (
                  <p>Excess will be split across upcoming installments.</p>
                )}
              </>
            ) : (
              <>
                {clearedB > 0 && (
                  <p>
                    Closes next {clearedB} installment{clearedB > 1 ? 's' : ''} early ·
                    <span className="font-semibold">
                      {' '}
                      {formatINR(waivedInterestB)} interest waived
                    </span>
                    .
                  </p>
                )}
                {remB > 0.005 && (
                  <p>
                    Remaining{' '}
                    <span className="font-semibold">{formatINR(remB)}</span> reduces
                    the principal of the next unpaid installment.
                  </p>
                )}
                {clearedB === 0 && remB === 0 && (
                  <p>Excess will be split across upcoming installments.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {quote && futureUnpaid > 0 && interestShare > 0.005 && (
        <label className="flex items-start gap-2 text-xs text-emerald-900 dark:text-emerald-200 cursor-pointer rounded-md border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
          <input
            type="checkbox"
            checked={waiveInterest}
            onChange={(e) => onWaiveChange(e.target.checked)}
            className="mt-0.5 rounded border-emerald-300"
          />
          <span>
            <span className="font-semibold">Waive interest on prepayment.</span> When
            checked, future installments fully cleared by this excess will only
            charge principal + file charge — saves the customer{' '}
            <span className="font-semibold">{formatINR(waivedInterestB)}</span>.
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * Editor for splitting one payment across up to 3 modes (cash + UPI etc.).
 * - 1 split: shows mode pills only (legacy single-mode UX, no amount input).
 * - 2-3 splits: shows mode dropdown + amount input per row, plus a live
 *   "remaining to allocate" badge so the collector sees if amounts add up.
 * Default state: a single CASH split with empty amount (treated as the full
 * total at submit time).
 */
function PaymentSplitsEditor({
  splits,
  onChange,
  total,
}: {
  splits: Split[];
  onChange: (next: Split[]) => void;
  total: number;
}) {
  const sum = sumSplits(splits);
  const remaining = Math.round((total - sum) * 100) / 100;
  const isMulti = splits.length > 1;

  const setSplit = (idx: number, patch: Partial<Split>) => {
    const next = splits.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  };

  const addSplit = () => {
    if (splits.length >= 3) return;
    // Default the new split's amount to whatever's left (>= 0).
    const defaultAmount = remaining > 0 ? remaining : '';
    onChange([
      ...splits,
      { mode: PaymentMode.CASH, amount: defaultAmount as number | '' },
    ]);
  };

  const removeSplit = (idx: number) => {
    if (splits.length <= 1) return;
    onChange(splits.filter((_, i) => i !== idx));
  };

  if (!isMulti) {
    // Single mode — pill row identical to old UX. Amount is implicit (= total).
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {paymentModes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setSplit(0, { mode: mode.value })}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium border transition-colors',
                splits[0].mode === mode.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground',
              )}
            >
              {mode.label}
            </button>
          ))}
          <button
            type="button"
            onClick={addSplit}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium',
              'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            )}
            title="Add another payment mode"
          >
            <Plus className="h-3 w-3" />
            Split
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 min-w-0">
      {splits.map((s, i) => (
        <div key={i} className="flex items-center gap-2 min-w-0">
          <select
            value={s.mode}
            onChange={(e) => setSplit(i, { mode: e.target.value as PaymentMode })}
            className={cn(
              'shrink-0 rounded-md border bg-field px-2 py-1.5 text-xs',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            {paymentModes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            value={s.amount}
            onChange={(e) =>
              setSplit(i, {
                amount: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            placeholder="0.00"
            className={cn(
              'flex-1 min-w-0 rounded-md border bg-field px-2 py-1.5 text-xs',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          />
          <button
            type="button"
            onClick={() => removeSplit(i)}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
            title="Remove split"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        {splits.length < 3 ? (
          <button
            type="button"
            onClick={addSplit}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs font-medium',
              'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            )}
          >
            <Plus className="h-3 w-3" />
            Add another mode
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">Max 3 modes</span>
        )}
        <span
          className={cn(
            'text-xs',
            Math.abs(remaining) <= 0.5
              ? 'text-emerald-700 dark:text-emerald-400'
              : remaining > 0
                ? 'text-muted-foreground'
                : 'text-destructive',
          )}
        >
          {Math.abs(remaining) <= 0.5
            ? '✓ Splits match total'
            : remaining > 0
              ? `Remaining ${formatINR(remaining)}`
              : `Over by ${formatINR(-remaining)}`}
        </span>
      </div>
    </div>
  );
}
