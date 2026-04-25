import { useState } from 'react';
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle,
  CalendarClock,
  ArrowRightLeft,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRecordInstallmentPaymentMutation } from '../hooks/useInstallments';
import { formatINR } from '@retailerp/shared-utils';
import { PaymentMode } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface RecordPaymentDialogProps {
  installmentId: string;
  amountDue: number;
  installmentNumber?: number;
  defaultDate?: string; // ISO date string for the installment due date
  initialScenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RecordPaymentDialog({
  installmentId,
  amountDue,
  installmentNumber,
  defaultDate,
  initialScenario = 'full_payment',
  onSuccess,
  onClose,
}: RecordPaymentDialogProps) {
  const todayStr = new Date().toISOString().split('T')[0];
  const [scenario, setScenario] = useState<Scenario>(initialScenario);

  // Full payment state
  const [fullAmount, setFullAmount] = useState<string>(String(amountDue));
  const [fullMode, setFullMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [fullDate, setFullDate] = useState<string>(defaultDate || todayStr);
  const [fullNotes, setFullNotes] = useState('');
  const [earlyCollectionDate, setEarlyCollectionDate] = useState('');

  // Reschedule state
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  // Partial + reschedule state
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [partialMode, setPartialMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [partialDate, setPartialDate] = useState('');
  const [partialNotes, setPartialNotes] = useState('');

  const mutation = useRecordInstallmentPaymentMutation();

  const partialRemaining = amountDue - (Number(partialAmount) || 0);

  // Validation
  const isFullValid = Number(fullAmount) > 0;
  const isRescheduleValid = !!rescheduleDate;
  const isPartialValid =
    Number(partialAmount) > 0 &&
    Number(partialAmount) < amountDue &&
    !!partialDate;

  const handleSubmit = () => {
    let payload: {
      scenario: Scenario;
      amountPaid?: number;
      paymentMode?: string;
      paymentDate?: string;
      newDate?: string;
      notes?: string;
      earlyCollectionDate?: string;
    };

    if (scenario === 'full_payment') {
      payload = {
        scenario: 'full_payment',
        amountPaid: Number(fullAmount),
        paymentMode: fullMode,
        paymentDate: fullDate || undefined,
        notes: fullNotes.trim() || undefined,
        earlyCollectionDate: earlyCollectionDate || undefined,
      };
    } else if (scenario === 'reschedule') {
      payload = {
        scenario: 'reschedule',
        newDate: rescheduleDate,
        notes: rescheduleNotes.trim() || undefined,
      };
    } else {
      payload = {
        scenario: 'partial_reschedule',
        amountPaid: Number(partialAmount),
        paymentMode: partialMode,
        newDate: partialDate,
        notes: partialNotes.trim() || undefined,
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
      <div className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl mx-4 max-h-[90vh] overflow-y-auto">
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

        <p className="text-sm text-muted-foreground mb-4">
          Amount due:{' '}
          <span className="font-semibold text-foreground">
            {formatINR(amountDue)}
          </span>
        </p>

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
                onChange={(e) => setFullAmount(e.target.value)}
                placeholder="0.00"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              {Number(fullAmount) > amountDue && (
                <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-400">
                  Excess of {formatINR(Number(fullAmount) - amountDue)} will be
                  deducted equally from upcoming installments.
                </p>
              )}
            </div>

            {/* Payment Date */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Payment Date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={fullDate}
                onChange={(e) => setFullDate(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Payment Mode Pills */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Payment Mode <span className="text-destructive">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {paymentModes.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setFullMode(mode.value)}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-sm font-medium border transition-colors',
                      fullMode === mode.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground',
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
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
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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
              <input
                type="date"
                value={earlyCollectionDate}
                onChange={(e) => setEarlyCollectionDate(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
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
              <input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
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
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              {Number(partialAmount) >= amountDue && (
                <p className="mt-1 text-xs text-destructive">
                  Amount must be less than {formatINR(amountDue)}
                </p>
              )}
            </div>

            {/* Payment Mode Pills */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Payment Mode <span className="text-destructive">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {paymentModes.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setPartialMode(mode.value)}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-sm font-medium border transition-colors',
                      partialMode === mode.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground',
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
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
              <input
                type="date"
                value={partialDate}
                onChange={(e) => setPartialDate(e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
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
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
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
    </div>
  );
}
