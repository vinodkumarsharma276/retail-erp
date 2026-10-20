import { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertCircle,
  CheckCircle,
  Undo2,
  Plus,
  Trash2,
  Clock,
  BadgePercent,
  CalendarClock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useRecordInstallmentPaymentMutation,
  useInterestAccrualQuery,
  useRollbackInterestApplicationMutation,
  usePaymentPreviewQuery,
  useInstallmentPromisesQuery,
} from '../hooks/useInstallments';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { PaymentMode } from '@retailerp/shared-types';
import { useCanCheck } from '../hooks/usePermission';
import { useToastStore } from '../stores/toast-store';
import { nextPromiseLabels } from '../lib/promise-labels';
import { DateInput } from './DateInput';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { useEscapeKey } from '../hooks/useEscapeKey';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface RecordPaymentDialogProps {
  /** Any EMI on the sale — it identifies the account being paid. */
  installmentId: string;
  /** Unpaid balance on the EMI, used until the live preview loads. */
  amountDue: number;
  installmentNumber?: number;
  /** @deprecated Ignored. The payment date always starts at today. */
  defaultDate?: string;
  /** @deprecated Ignored. One form handles full and part payments. */
  initialScenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
  /** Enables promise labels and "undo last penalty". */
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

interface Row {
  installmentId: string;
  installmentNumber: number;
  dueDate: string;
  /** Owing on this EMI after the ticked penalty/deduction. */
  owing: number;
  /** What this payment puts on it. */
  paid: number;
  /** Due on or before the payment date (or the EMI picked to pay). */
  dueNow: boolean;
  plannedAmount: number;
  /** Earlier shortfalls spread onto this EMI. */
  carriedIn: Array<{ fromInstallmentNumber: number; amount: number }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
/**
 * One payment against a sale. Money goes to the oldest EMI still owing,
 * then the next — unless the collector picks an EMI to pay first. Every EMI
 * keeps its own due date. If the customer pays less than is due, the
 * collector may note when the rest will come; that promise is saved with the
 * payment and labelled the register way ("1.1" = first promise on EMI 1).
 */
export function RecordPaymentDialog({
  installmentId,
  amountDue,
  scheduleId,
  onSuccess,
  onClose,
}: RecordPaymentDialogProps) {
  useEscapeKey(true, onClose);

  const can = useCanCheck();
  const addToast = useToastStore((s) => s.addToast);
  const canChargePenalty = can('installments.interest.apply');
  const canUndoPenalty = can('installments.interest.rollback');

  const today = localTodayIso();
  const [paymentDate, setPaymentDate] = useState<string>(today);
  /** '' = oldest first (the default). Otherwise the EMI to pay first. */
  const [firstEmi, setFirstEmi] = useState<string>('');

  // Everything money-related comes from the server for the chosen date, so
  // what the collector sees is exactly what will be saved.
  const previewQuery = usePaymentPreviewQuery(installmentId, paymentDate || undefined, firstEmi || undefined);
  const preview = previewQuery.data;
  const { data: promises } = useInstallmentPromisesQuery({ scheduleId });

  // Both adjustments start OFF. The collector decides.
  const [chargePenalty, setChargePenalty] = useState(false);
  const [giveDeduction, setGiveDeduction] = useState(false);
  const penaltyAvailable = !!preview?.penalty.applicable && canChargePenalty;
  const deductionAvailable = !!preview?.earlyPayment.applicable;
  useEffect(() => {
    if (!penaltyAvailable) setChargePenalty(false);
  }, [penaltyAvailable]);
  useEffect(() => {
    if (!deductionAvailable) setGiveDeduction(false);
  }, [deductionAvailable]);

  const penaltyCharged = chargePenalty && preview ? preview.penalty.amount : 0;
  const deductionTotal = giveDeduction && preview ? preview.earlyPayment.amount : 0;

  // --- Amount + promise state ----------------------------------------------
  const [amount, setAmount] = useState<string>('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [splits, setSplits] = useState<Split[]>([{ mode: PaymentMode.CASH, amount: '' }]);
  const [notes, setNotes] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [includeNextEmi, setIncludeNextEmi] = useState(false);
  /** A due EMI left short: spread the rest over later EMIs (shop default) or keep it owed. */
  const [shortfallMode, setShortfallMode] = useState<'spread' | 'keep'>('spread');
  const amountNum = Number(amount) || 0;

  // --- Order the EMIs and simulate where the money goes ---------------------
  const { rows, dueNowTotal, extra } = useMemo(() => {
    const outstanding = preview?.outstanding ?? [];
    const firstId = preview?.installmentId;
    const ordered = [
      ...outstanding.filter((o) => o.installmentId === firstId),
      ...outstanding.filter((o) => o.installmentId !== firstId),
    ];

    // Early deduction comes off the LAST installment(s), last first.
    const deductionOn = new Map<string, number>();
    let deductionLeft = deductionTotal;
    for (const n of preview?.earlyPayment.targetInstallmentNumbers ?? []) {
      const row = outstanding.find((o) => o.installmentNumber === n);
      if (!row || deductionLeft <= 0) continue;
      const take = Math.min(deductionLeft, row.remainingAmount);
      deductionOn.set(row.installmentId, take);
      deductionLeft = round2(deductionLeft - take);
    }

    let left = amountNum;
    const built: Row[] = ordered.map((o, index) => {
      const owing = round2(
        o.remainingAmount + (index === 0 ? penaltyCharged : 0) - (deductionOn.get(o.installmentId) ?? 0),
      );
      const paid = round2(Math.min(Math.max(left, 0), owing));
      left = round2(left - paid);
      return {
        installmentId: o.installmentId,
        installmentNumber: o.installmentNumber,
        dueDate: o.dueDate,
        owing,
        paid,
        dueNow: index === 0 || o.dueDate <= paymentDate,
        plannedAmount: o.plannedAmount,
        carriedIn: o.carriedIn,
      };
    });
    const due = round2(built.filter((r) => r.dueNow).reduce((s, r) => s + r.owing, 0));
    return { rows: built, dueNowTotal: due, extra: Math.max(0, left) };
  }, [preview, amountNum, penaltyCharged, deductionTotal, paymentDate]);

  // Default the amount to what is due now, until the collector types.
  useEffect(() => {
    if (!amountTouched && preview) setAmount(String(dueNowTotal));
  }, [dueNowTotal, amountTouched, preview]);

  const shortBy = round2(dueNowTotal - amountNum);
  // The due EMI this payment leaves part-paid (at most one), and the EMIs after
  // it that would share its shortfall if spread.
  const shortRow = rows.find((r) => r.dueNow && r.paid > 0 && r.owing - r.paid > 0.004);
  const shortfall = shortRow ? round2(shortRow.owing - shortRow.paid) : 0;
  const spreadTargets = shortRow
    ? rows
        .filter((r) => r.installmentNumber > shortRow.installmentNumber && r.owing > 0)
        .sort((a, b) => a.installmentNumber - b.installmentNumber)
    : [];
  const canSpread = spreadTargets.length > 0;
  const spreading = !!shortRow && canSpread && shortfallMode === 'spread';
  const spreadEach = spreading ? Math.floor(shortfall / spreadTargets.length) : 0;
  const spreadFirst = spreading ? round2(shortfall - spreadEach * (spreadTargets.length - 1)) : 0;
  // Still owed after this entry on EMIs already due. When spreading, the
  // short EMI counts as paid, so only EMIs that got nothing remain.
  const leftOwing = rows.filter(
    (r) => r.dueNow && r.owing - r.paid > 0.004 && !(spreading && r.installmentId === shortRow?.installmentId),
  );
  const nextEmi = rows.find((r) => !r.dueNow);
  const promiseReachesNextEmi = !!promiseDate && !!nextEmi && promiseDate >= nextEmi.dueDate;
  useEffect(() => {
    if (!promiseReachesNextEmi) setIncludeNextEmi(false);
  }, [promiseReachesNextEmi]);

  const covered = [...leftOwing, ...(includeNextEmi && nextEmi ? [nextEmi] : [])];
  const promiseAmount = round2(covered.reduce((s, r) => s + (r.owing - r.paid), 0));
  const promiseLabel = covered.length > 0 ? nextPromiseLabels(promises, covered) : '';

  // A deduction is earned by clearing the EMI in full.
  const firstRow = rows[0];
  const deductionNeedsFull = giveDeduction && !!firstRow && firstRow.paid < firstRow.owing - 0.004;

  // --- Undo the most recent penalty charge on this sale --------------------
  const { data: accrualList } = useInterestAccrualQuery(scheduleId, !!scheduleId);
  const lastCharge =
    accrualList
      ?.flatMap((a) => a.applications ?? [])
      .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())[0] ?? null;
  const [undoReason, setUndoReason] = useState('');
  const rollbackMutation = useRollbackInterestApplicationMutation();

  const mutation = useRecordInstallmentPaymentMutation();

  const splitsValid =
    splits.length === 1 ||
    (splits.every((s) => Number(s.amount) > 0) && Math.abs(sumSplits(splits) - amountNum) <= 0.5);
  const promiseValid = !promiseDate || (promiseDate >= today && covered.length > 0);
  const isValid =
    !!preview && !!paymentDate && amountNum > 0 && splitsValid && promiseValid && !deductionNeedsFull;

  const handleSubmit = () => {
    const breakdown = buildBreakdown(splits, amountNum);
    mutation.mutate(
      {
        installmentId,
        payload: {
          amountPaid: amountNum,
          paymentMode: breakdown ? breakdown[0].mode : splits[0].mode,
          paymentBreakdown: breakdown,
          paymentDate,
          explicitInstallmentId: firstEmi || undefined,
          notes: notes.trim() || undefined,
          applyPenalty: chargePenalty,
          applyEarlyPaymentDeduction: giveDeduction,
          shortfall: shortRow ? (spreading ? 'spread' : 'keep') : undefined,
          promise:
            promiseDate && covered.length > 0
              ? {
                  promisedDate: promiseDate,
                  coveredInstallmentIds: covered.map((r) => r.installmentId),
                  notes: notes.trim() || undefined,
                }
              : undefined,
        },
      },
      {
        onSuccess: () => {
          const extras = [
            penaltyCharged > 0 ? `${formatINR(penaltyCharged)} penalty charged` : null,
            deductionTotal > 0 ? `${formatINR(deductionTotal)} deducted from the last EMI` : null,
            promiseDate && covered.length > 0 ? `promise ${promiseLabel} for ${formatDateIN(promiseDate)}` : null,
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

  const daysLate =
    preview?.penalty.overdueSince
      ? Math.max(0, daysBetweenIso(preview.penalty.overdueSince, preview.asOf))
      : 0;
  const targets = preview?.earlyPayment.targetInstallmentNumbers ?? [];
  const targetLabel =
    targets.length === 0
      ? 'the last installment'
      : targets.length === 1
        ? `EMI #${targets[0]}`
        : `EMIs ${targets.map((t) => `#${t}`).join(', ')}`;
  const owingCount = preview?.outstanding.length ?? 0;
  const fallbackDue = Number(amountDue) || 0;

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
              {preview
                ? `${owingCount} EMI${owingCount === 1 ? '' : 's'} still owing · ${formatINR(dueNowTotal)} due by ${formatDateIN(paymentDate)}`
                : `${formatINR(fallbackDue)} on this EMI`}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="scrollbar-auto overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
            {/* ---------------- Form ---------------- */}
            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="payment-date" required>Payment date</Label>
                  <DateInput value={paymentDate} onChange={(v) => setPaymentDate(v)} max={today} />
                </div>
                <div>
                  <Label htmlFor="first-emi">Pay first</Label>
                  <select
                    id="first-emi"
                    value={firstEmi}
                    onChange={(e) => setFirstEmi(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-field px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Oldest unpaid EMI</option>
                    {(preview?.outstanding ?? []).map((o) => (
                      <option key={o.installmentId} value={o.installmentId}>
                        EMI #{o.installmentNumber} · due {formatDateIN(o.dueDate)} · {formatINR(o.remainingAmount)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="amount" required>Amount received</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmountTouched(true);
                    setAmount(e.target.value);
                  }}
                />
                {amountTouched && Math.abs(shortBy) > 0.004 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmountTouched(false);
                      setAmount(String(dueNowTotal));
                    }}
                    className="mt-1 text-xs text-primary hover:underline"
                  >
                    Reset to {formatINR(dueNowTotal)} (due now)
                  </button>
                )}
                {extra > 0.004 && (
                  <p className="mt-1 text-xs text-warning">
                    {formatINR(extra)} more than everything owing — it will be kept as credit on this sale.
                  </p>
                )}
                {deductionNeedsFull && firstRow && (
                  <p className="mt-1 text-xs text-destructive">
                    The early-payment deduction needs EMI #{firstRow.installmentNumber} paid in full
                    ({formatINR(firstRow.owing)}).
                  </p>
                )}
              </div>

              <div>
                <Label required>Payment mode</Label>
                <PaymentSplitsEditor splits={splits} onChange={setSplits} total={amountNum} />
              </div>

              {/* Short payment — spread it (shop default) or keep it on the EMI */}
              {preview && shortBy > 0.004 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatINR(shortBy)} less than is due
                  </p>

                  {shortRow && (
                    canSpread ? (
                      <div className="mt-2 space-y-2 text-sm">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name="shortfall"
                            checked={shortfallMode === 'spread'}
                            onChange={() => setShortfallMode('spread')}
                            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                          />
                          <span>
                            Spread {formatINR(shortfall)} over the remaining {spreadTargets.length} EMI
                            {spreadTargets.length === 1 ? '' : 's'}
                            <span className="block text-xs text-muted-foreground">
                              EMI #{shortRow.installmentNumber} counts as paid.{' '}
                              {spreadTargets.length === 1
                                ? `EMI #${spreadTargets[0].installmentNumber} goes up by ${formatINR(shortfall)}.`
                                : spreadFirst === spreadEach
                                  ? `Each goes up by ${formatINR(spreadEach)}.`
                                  : `EMI #${spreadTargets[0].installmentNumber} goes up by ${formatINR(spreadFirst)}, the rest by ${formatINR(spreadEach)}.`}
                            </span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name="shortfall"
                            checked={shortfallMode === 'keep'}
                            onChange={() => setShortfallMode('keep')}
                            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                          />
                          <span>
                            Keep it on EMI #{shortRow.installmentNumber}
                            <span className="block text-xs text-muted-foreground">
                              The customer will bring {formatINR(shortfall)} separately — note the date below.
                            </span>
                          </span>
                        </label>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        EMI #{shortRow.installmentNumber} is the last one, so {formatINR(shortfall)} stays on it.
                      </p>
                    )
                  )}

                  {leftOwing.length > 0 && (
                    <>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Still owed on EMI {leftOwing.map((r) => `#${r.installmentNumber}`).join(', ')}. If the customer
                        said when they'll pay, note the date — optional.
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="promise-date">Will pay on</Label>
                          <DateInput value={promiseDate} onChange={(v) => setPromiseDate(v)} min={today} />
                        </div>
                        {promiseDate && covered.length > 0 && (
                          <div className="self-end pb-1 text-sm">
                            Promise <span className="font-semibold tabular">{promiseLabel}</span> ·{' '}
                            <span className="tabular">{formatINR(promiseAmount)}</span>
                          </div>
                        )}
                      </div>
                      {promiseDate && promiseDate < today && (
                        <p className="mt-1 text-xs text-destructive">A promise date can't be in the past.</p>
                      )}
                      {promiseReachesNextEmi && nextEmi && (
                        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={includeNextEmi}
                            onChange={(e) => setIncludeNextEmi(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-border-strong accent-[hsl(var(--primary))]"
                          />
                          <span>
                            Also collect EMI #{nextEmi.installmentNumber} (due {formatDateIN(nextEmi.dueDate)},{' '}
                            {formatINR(nextEmi.owing)}) on that date
                          </span>
                        </label>
                      )}
                    </>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>

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
                    {daysLate > 0 ? `Behind by ${daysLate} day${daysLate === 1 ? '' : 's'}` : 'Late penalty'}
                  </p>
                  {preview.penalty.overdueSince && (
                    <p className="text-xs text-muted-foreground">
                      Oldest unpaid EMI was due {formatDateIN(preview.penalty.overdueSince)}. Penalty is per
                      sale, however many EMIs are late.
                    </p>
                  )}

                  {preview.penalty.applicable ? (
                    <p className="mt-1 text-xs text-foreground/80">
                      {formatINR(preview.penalty.perDay)}/day × {preview.penalty.days}
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
              {preview && preview.earlyPayment.daysEarly > 0 && (
                deductionAvailable ? (
                  <div className="rounded-lg border border-primary/25 bg-primary-muted p-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                      <BadgePercent className="h-3.5 w-3.5" />
                      EMI #{preview.installmentNumber} paid {preview.earlyPayment.daysEarly} days early
                    </p>
                    <p className="mt-1 text-xs text-foreground/80">
                      It includes {formatINR(preview.earlyPayment.amount)} of the interest charged at sale.
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

              {/* Where the money goes */}
              <div className="rounded-lg border border-border bg-subtle p-3">
                <p className="text-overline mb-2">Where it goes</p>
                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{previewQuery.isLoading ? 'Loading…' : 'Nothing owing.'}</p>
                ) : (
                  <dl className="space-y-1.5 text-sm">
                    {rows
                      .filter((r) => r.dueNow || r.paid > 0)
                      .map((r, index) => (
                        <div key={r.installmentId} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">
                            EMI #{r.installmentNumber}
                            {index === 0 && penaltyCharged > 0 ? ' + penalty' : ''}
                            <span className="block text-[11px]">
                              {r.paid >= r.owing - 0.004
                                ? 'cleared'
                                : spreading && r.installmentId === shortRow?.installmentId
                                  ? `paid · ${formatINR(shortfall)} spread`
                                  : r.paid > 0
                                    ? `${formatINR(round2(r.owing - r.paid))} left`
                                    : `due ${formatDateIN(r.dueDate)}`}
                            </span>
                            {r.carriedIn.length > 0 && (
                              <span className="block text-[11px] text-warning">
                                {formatINR(r.plannedAmount)} planned +{' '}
                                {r.carriedIn.map((c) => `${formatINR(c.amount)} from #${c.fromInstallmentNumber}`).join(' + ')}
                              </span>
                            )}
                          </dt>
                          <dd className="tabular font-medium">
                            {formatINR(r.paid)}
                            <span className="text-muted-foreground"> / {formatINR(r.owing)}</span>
                          </dd>
                        </div>
                      ))}
                    {extra > 0.004 && (
                      <div className="flex justify-between gap-3 text-warning">
                        <dt>Credit</dt>
                        <dd className="tabular font-medium">{formatINR(extra)}</dd>
                      </div>
                    )}
                    <div className="mt-1.5 flex justify-between gap-3 border-t border-border pt-1.5">
                      <dt className="font-medium">Received</dt>
                      <dd className="tabular text-base font-semibold">{formatINR(amountNum)}</dd>
                    </div>
                    {spreading && (
                      <p className="pt-1 text-xs text-warning">
                        {formatINR(shortfall)} from EMI #{shortRow!.installmentNumber} is added to EMI{' '}
                        {spreadTargets.length === 1
                          ? `#${spreadTargets[0].installmentNumber}`
                          : `#${spreadTargets[0].installmentNumber}–#${spreadTargets[spreadTargets.length - 1].installmentNumber}`}
                        .
                      </p>
                    )}
                    {deductionTotal > 0 && (
                      <p className="pt-1 text-xs text-primary">
                        {formatINR(deductionTotal)} comes off {targetLabel}.
                      </p>
                    )}
                  </dl>
                )}
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
            disabled={!isValid || previewQuery.isLoading}
            icon={<CheckCircle className="h-4 w-4" />}
          >
            Record {formatINR(amountNum)}
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
