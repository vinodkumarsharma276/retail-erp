import { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertCircle,
  CheckCircle,
  ArrowRightLeft,
  Undo2,
  Plus,
  Trash2,
  Clock,
  BadgePercent,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useRecordInstallmentPaymentMutation,
  useInterestAccrualQuery,
  useRollbackInterestApplicationMutation,
  usePaymentPreviewQuery,
} from '../hooks/useInstallments';
import { formatINR } from '@retailerp/shared-utils';
import { PaymentMode } from '@retailerp/shared-types';
import { useCanCheck } from '../hooks/usePermission';
import { useToastStore } from '../stores/toast-store';
import { DateInput } from './DateInput';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Tabs } from './ui/tabs';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface RecordPaymentDialogProps {
  installmentId: string;
  /** Unpaid balance on the EMI, used until the live preview loads. */
  amountDue: number;
  installmentNumber?: number;
  /**
   * @deprecated Ignored. The payment date always starts at today — defaulting
   * it to the EMI's due date silently backdated late payments, which hid the
   * lateness and zeroed the penalty.
   */
  defaultDate?: string;
  /** `'reschedule'` is accepted for old callers and opens the part-payment tab. */
  initialScenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
  /** Enables "undo last penalty" for this EMI. */
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

type Scenario = 'full_payment' | 'partial_reschedule';

interface Split {
  mode: PaymentMode;
  amount: number | '';
}

function sumSplits(splits: Split[]): number {
  return splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Today in the user's own timezone. `toISOString()` is UTC, which in India
 * reports yesterday's date until 5:30 am — and a payment date one day off
 * changes the penalty.
 */
function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Last split takes the residue so the parts always sum to the total exactly. */
function buildBreakdown(
  splits: Split[],
  total: number,
): Array<{ mode: string; amount: number }> | undefined {
  if (splits.length <= 1) return undefined;
  const others = splits.slice(0, -1).reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
  return splits.map((s, i) => ({
    mode: s.mode,
    amount: i === splits.length - 1 ? round2(total - others) : Number(s.amount),
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RecordPaymentDialog({
  installmentId,
  amountDue,
  installmentNumber,
  initialScenario = 'full_payment',
  scheduleId,
  onSuccess,
  onClose,
}: RecordPaymentDialogProps) {
  const can = useCanCheck();
  const addToast = useToastStore((s) => s.addToast);
  const canChargePenalty = can('installments.interest.apply');
  const canUndoPenalty = can('installments.interest.rollback');

  const [scenario, setScenario] = useState<Scenario>(
    initialScenario === 'full_payment' ? 'full_payment' : 'partial_reschedule',
  );
  const [paymentDate, setPaymentDate] = useState<string>(localTodayIso());

  // Everything money-related comes from the server for the chosen date, so
  // what the collector sees is exactly what will be saved.
  const previewQuery = usePaymentPreviewQuery(installmentId, paymentDate || undefined);
  const preview = previewQuery.data;

  // Both adjustments start OFF. The collector decides; the system never
  // charges or gives anything on its own.
  const [chargePenalty, setChargePenalty] = useState(false);
  const [giveDeduction, setGiveDeduction] = useState(false);

  const penaltyAvailable = !!preview?.penalty.applicable && canChargePenalty;
  const deductionAvailable = !!preview?.earlyPayment.applicable && scenario === 'full_payment';

  // If a date change makes an adjustment unavailable, drop the tick with it.
  useEffect(() => {
    if (!penaltyAvailable) setChargePenalty(false);
  }, [penaltyAvailable]);
  useEffect(() => {
    if (!deductionAvailable) setGiveDeduction(false);
  }, [deductionAvailable]);

  // --- The arithmetic the collector sees -----------------------------------
  const baseDue = preview?.remainingAmount ?? (Number(amountDue) || 0);
  const penaltyCharged = chargePenalty && preview ? preview.penalty.amount : 0;
  const deductionTotal = giveDeduction && preview ? preview.earlyPayment.amount : 0;
  // The deduction comes off the LAST installment. Only when that is this very
  // EMI does it change what's collected today.
  const deductionOnThisEmi =
    giveDeduction && preview && preview.earlyPayment.targetInstallmentNumbers.includes(preview.installmentNumber)
      ? Math.min(deductionTotal, baseDue + penaltyCharged)
      : 0;
  const toCollect = round2(baseDue + penaltyCharged - deductionOnThisEmi);
  const daysLate = preview ? Math.max(0, daysBetweenIso(preview.dueDate, preview.asOf)) : 0;

  // --- Undo the most recent penalty charge on this EMI ---------------------
  const { data: accrualList } = useInterestAccrualQuery(scheduleId, !!scheduleId);
  const lastCharge =
    accrualList?.find((a) => a.installmentId === installmentId)?.applications?.[0] ?? null;
  const [undoReason, setUndoReason] = useState('');
  const rollbackMutation = useRollbackInterestApplicationMutation();

  // --- Full payment ---------------------------------------------------------
  const [fullAmount, setFullAmount] = useState<string>(String(baseDue));
  const [fullAmountTouched, setFullAmountTouched] = useState(false);
  const [fullSplits, setFullSplits] = useState<Split[]>([{ mode: PaymentMode.CASH, amount: '' }]);
  const [fullNotes, setFullNotes] = useState('');

  // Keep the amount in step with the ticks until the collector types their own.
  useEffect(() => {
    if (!fullAmountTouched) setFullAmount(String(toCollect));
  }, [toCollect, fullAmountTouched]);

  // --- Part payment ---------------------------------------------------------
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [partialSplits, setPartialSplits] = useState<Split[]>([{ mode: PaymentMode.CASH, amount: '' }]);
  const [partialDate, setPartialDate] = useState('');
  const [partialNotes, setPartialNotes] = useState('');

  const mutation = useRecordInstallmentPaymentMutation();

  const splitsValid = (splits: Split[], total: number) =>
    splits.length === 1 ||
    (splits.every((s) => Number(s.amount) > 0) && Math.abs(sumSplits(splits) - total) <= 0.5);

  const fullAmountNum = Number(fullAmount) || 0;
  const overBy = round2(fullAmountNum - toCollect);
  const isFullValid =
    !!paymentDate && fullAmountNum > 0 && fullAmountNum >= toCollect && splitsValid(fullSplits, fullAmountNum);

  const partialAmountNum = Number(partialAmount) || 0;
  const partialLeft = round2(toCollect - partialAmountNum);
  const isPartialValid =
    !!paymentDate &&
    partialAmountNum > 0 &&
    partialAmountNum < toCollect &&
    !!partialDate &&
    splitsValid(partialSplits, partialAmountNum);

  const handleSubmit = () => {
    const isFull = scenario === 'full_payment';
    const amount = isFull ? fullAmountNum : partialAmountNum;
    const splits = isFull ? fullSplits : partialSplits;
    const breakdown = buildBreakdown(splits, amount);

    mutation.mutate(
      {
        installmentId,
        payload: {
          scenario: isFull ? 'full_payment' : 'partial_reschedule',
          amountPaid: amount,
          paymentMode: breakdown ? breakdown[0].mode : splits[0].mode,
          paymentBreakdown: breakdown,
          paymentDate,
          newDate: isFull ? undefined : partialDate,
          notes: (isFull ? fullNotes : partialNotes).trim() || undefined,
          applyPenalty: chargePenalty,
          applyEarlyPaymentDeduction: isFull && giveDeduction,
        },
      },
      {
        onSuccess: () => {
          const extras = [
            penaltyCharged > 0 ? `${formatINR(penaltyCharged)} penalty charged` : null,
            deductionTotal > 0 ? `${formatINR(deductionTotal)} deducted from the last EMI` : null,
          ].filter(Boolean);
          addToast({
            type: 'success',
            message: extras.length > 0 ? `Payment recorded · ${extras.join(' · ')}` : 'Payment recorded',
          });
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

  const targets = preview?.earlyPayment.targetInstallmentNumbers ?? [];
  const targetLabel =
    targets.length === 0
      ? 'the last installment'
      : targets.length === 1
        ? `EMI #${targets[0]}`
        : `EMIs ${targets.map((t) => `#${t}`).join(', ')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-payment-title"
        className="animate-scale-in relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="record-payment-title" className="text-title">Record payment</h3>
            <p className="text-caption">
              {installmentNumber || preview?.installmentNumber
                ? `EMI #${installmentNumber ?? preview?.installmentNumber}`
                : 'Installment'}
              {preview && <> · due {preview.dueDate}</>}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="scrollbar-auto overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <Tabs
              aria-label="Payment type"
              value={scenario}
              onChange={(v) => setScenario(v as Scenario)}
              items={[
                { value: 'full_payment', label: 'Full payment' },
                { value: 'partial_reschedule', label: 'Part payment' },
              ]}
            />
            <div className="w-44">
              <Label htmlFor="payment-date" required>Payment date</Label>
              <DateInput value={paymentDate} onChange={(v) => setPaymentDate(v)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
            {/* ---------------- Form ---------------- */}
            <div className="min-w-0 space-y-4">
              {scenario === 'full_payment' ? (
                <>
                  <div>
                    <Label htmlFor="full-amount" required>Amount received</Label>
                    <Input
                      id="full-amount"
                      type="number"
                      step="0.01"
                      value={fullAmount}
                      onChange={(e) => {
                        setFullAmountTouched(true);
                        setFullAmount(e.target.value);
                      }}
                    />
                    {fullAmountNum > 0 && fullAmountNum < toCollect && (
                      <p className="mt-1 text-xs text-destructive">
                        Full payment needs at least {formatINR(toCollect)}. Use “Part payment” for less.
                      </p>
                    )}
                    {overBy > 0.5 && (
                      <p className="mt-1 text-xs text-warning">
                        {formatINR(overBy)} more than this EMI. Extra money isn't applied to other EMIs yet —
                        record it against the next EMI as a separate payment.
                      </p>
                    )}
                    {fullAmountTouched && Math.abs(overBy) > 0.004 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFullAmountTouched(false);
                          setFullAmount(String(toCollect));
                        }}
                        className="mt-1 text-xs text-primary hover:underline"
                      >
                        Reset to {formatINR(toCollect)}
                      </button>
                    )}
                  </div>

                  <div>
                    <Label required>Payment mode</Label>
                    <PaymentSplitsEditor splits={fullSplits} onChange={setFullSplits} total={fullAmountNum} />
                  </div>

                  <div>
                    <Label htmlFor="full-notes">Notes</Label>
                    <Textarea
                      id="full-notes"
                      rows={2}
                      value={fullNotes}
                      onChange={(e) => setFullNotes(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="partial-amount" required>Amount received</Label>
                    <Input
                      id="partial-amount"
                      type="number"
                      step="0.01"
                      value={partialAmount}
                      onChange={(e) => setPartialAmount(e.target.value)}
                      placeholder="0.00"
                    />
                    {partialAmountNum >= toCollect && toCollect > 0 && (
                      <p className="mt-1 text-xs text-destructive">
                        That covers the whole EMI — use “Full payment”.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label required>Payment mode</Label>
                    <PaymentSplitsEditor splits={partialSplits} onChange={setPartialSplits} total={partialAmountNum} />
                  </div>

                  <div>
                    <Label required>Customer will pay the rest on</Label>
                    <DateInput value={partialDate} onChange={(v) => setPartialDate(v)} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {partialLeft > 0 ? `${formatINR(partialLeft)} left on this EMI. ` : ''}
                      The EMI keeps its own due date; this is recorded as the customer's promise.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="partial-notes">Notes</Label>
                    <Textarea
                      id="partial-notes"
                      rows={2}
                      value={partialNotes}
                      onChange={(e) => setPartialNotes(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </>
              )}

              {mutationError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {mutationError}
                </div>
              )}
            </div>

            {/* ---------------- Adjustments + summary ---------------- */}
            <aside className="min-w-0 space-y-3">
              {/* Late penalty */}
              {preview && (preview.penalty.applicable || preview.penalty.alreadyCharged > 0) && (
                <div className="rounded-lg border border-warning/30 bg-warning-muted p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
                    <Clock className="h-3.5 w-3.5" />
                    {daysLate > 0 ? `Late by ${daysLate} day${daysLate === 1 ? '' : 's'}` : 'Late penalty'}
                  </p>

                  {preview.penalty.applicable ? (
                    <p className="mt-1 text-xs text-foreground/80">
                      {formatINR(preview.penalty.perDay)}/day × {preview.penalty.days}
                      {/* When earlier charges covered part of the lateness, say so —
                          otherwise "late by 25 days … × 2 days" reads as a mistake. */}
                      {preview.penalty.days < daysLate ? ' uncharged' : ''} day
                      {preview.penalty.days === 1 ? '' : 's'} ={' '}
                      <span className="tabular font-semibold">{formatINR(preview.penalty.amount)}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-foreground/80">Nothing new to charge for this date.</p>
                  )}
                  {preview.penalty.alreadyCharged > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatINR(preview.penalty.alreadyCharged)} already charged earlier.
                    </p>
                  )}

                  {preview.penalty.applicable && (
                    canChargePenalty ? (
                      <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          id="charge-penalty"
                          type="checkbox"
                          checked={chargePenalty}
                          onChange={(e) => setChargePenalty(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-border-strong accent-[hsl(var(--warning))]"
                        />
                        <span>Charge {formatINR(preview.penalty.amount)} penalty</span>
                      </label>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">You don't have permission to charge penalty.</p>
                    )
                  )}

                  {lastCharge && canUndoPenalty && (
                    <div className="mt-3 space-y-1.5 border-t border-warning/20 pt-2">
                      <p className="text-xs text-muted-foreground">
                        Last charge: {formatINR(Number(lastCharge.appliedAmount))}
                      </p>
                      <div className="flex gap-1.5">
                        <Input
                          id="undo-penalty-reason"
                          value={undoReason}
                          onChange={(e) => setUndoReason(e.target.value)}
                          placeholder="Reason to undo"
                          className="h-8 text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!undoReason.trim()}
                          loading={rollbackMutation.isPending}
                          icon={<Undo2 className="h-3 w-3" />}
                          onClick={() =>
                            rollbackMutation.mutate(
                              { applicationId: lastCharge.id, reason: undoReason.trim() },
                              {
                                onSuccess: () => {
                                  addToast({ type: 'success', message: 'Penalty charge undone' });
                                  setUndoReason('');
                                  void previewQuery.refetch();
                                },
                                onError: (err: unknown) =>
                                  addToast({
                                    type: 'error',
                                    message:
                                      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
                                      'Could not undo the charge',
                                  }),
                              },
                            )
                          }
                        >
                          Undo
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Early-payment deduction */}
              {preview && scenario === 'full_payment' && preview.earlyPayment.daysEarly > 0 && (
                deductionAvailable ? (
                  <div className="rounded-lg border border-primary/25 bg-primary-muted p-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                      <BadgePercent className="h-3.5 w-3.5" />
                      Paid {preview.earlyPayment.daysEarly} days early
                    </p>
                    <p className="mt-1 text-xs text-foreground/80">
                      This EMI includes {formatINR(preview.earlyPayment.amount)} of the interest charged at sale.
                    </p>
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        id="give-deduction"
                        type="checkbox"
                        checked={giveDeduction}
                        onChange={(e) => setGiveDeduction(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-border-strong accent-[hsl(var(--primary))]"
                      />
                      <span>
                        Deduct {formatINR(preview.earlyPayment.amount)} from {targetLabel}
                        {targets.length === 1 ? ' (last installment)' : ''}
                      </span>
                    </label>
                  </div>
                ) : (
                  preview.earlyPayment.reason && (
                    <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                      Paid {preview.earlyPayment.daysEarly} days early. No deduction offered:{' '}
                      {preview.earlyPayment.reason.charAt(0).toLowerCase() + preview.earlyPayment.reason.slice(1)}
                    </p>
                  )
                )
              )}

              {/* Summary */}
              <div className="rounded-lg border border-border bg-subtle p-3">
                <p className="text-overline mb-2">Summary</p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Due on this EMI</dt>
                    <dd className="tabular font-medium">{formatINR(baseDue)}</dd>
                  </div>
                  {penaltyCharged > 0 && (
                    <div className="flex justify-between gap-3 text-warning">
                      <dt>+ Late penalty</dt>
                      <dd className="tabular font-medium">{formatINR(penaltyCharged)}</dd>
                    </div>
                  )}
                  {deductionOnThisEmi > 0 && (
                    <div className="flex justify-between gap-3 text-primary">
                      <dt>− Early-payment deduction</dt>
                      <dd className="tabular font-medium">{formatINR(deductionOnThisEmi)}</dd>
                    </div>
                  )}
                  <div className="mt-1.5 flex justify-between gap-3 border-t border-border pt-1.5">
                    <dt className="font-medium">To collect</dt>
                    <dd className="tabular text-base font-semibold">{formatINR(toCollect)}</dd>
                  </div>
                  {deductionTotal - deductionOnThisEmi > 0.004 && (
                    <p className="pt-1 text-xs text-primary">
                      {formatINR(round2(deductionTotal - deductionOnThisEmi))} comes off {targetLabel}.
                    </p>
                  )}
                </dl>
              </div>
            </aside>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            loading={mutation.isPending}
            disabled={(scenario === 'full_payment' ? !isFullValid : !isPartialValid) || previewQuery.isLoading}
            icon={
              scenario === 'full_payment'
                ? <CheckCircle className="h-4 w-4" />
                : <ArrowRightLeft className="h-4 w-4" />
            }
          >
            {scenario === 'full_payment'
              ? `Record ${formatINR(fullAmountNum)}`
              : `Record ${formatINR(partialAmountNum)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
