import { useState } from 'react';
import { Loader2, Calculator, Check } from 'lucide-react';
import {
  useSettlementQuoteQuery,
  useRecordFinalSettlementMutation,
} from '../hooks/useInstallments';
import { formatINR } from '@retailerp/shared-utils';
import { useToastStore } from '../stores/toast-store';
import { cn } from '../lib/utils';

interface Props {
  scheduleId: string;
  /** Show the action button (Owner+Admin via permission gate). */
  canSettle: boolean;
}

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
];

/**
 * Card shown on Sale Detail (and accessible from the Installment payment
 * dialog) that surfaces a live "final settlement" quote: principal + file
 * charge for unpaid installments, with future interest waived.
 */
export function FinalSettlementCard({ scheduleId, canSettle }: Props) {
  const { data: quote, isLoading, isError } = useSettlementQuoteQuery(scheduleId);
  const settle = useRecordFinalSettlementMutation();
  const addToast = useToastStore((s) => s.addToast);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(() =>
    new Date().toISOString().split('T')[0],
  );
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Computing settlement quote…
        </div>
      </div>
    );
  }
  if (isError || !quote) {
    return null;
  }
  if (quote.unpaidCount === 0) {
    return null; // Nothing to settle
  }

  const handleConfirm = async () => {
    try {
      await settle.mutateAsync({
        scheduleId,
        payload: {
          paymentMode,
          paymentDate,
          referenceNumber: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
          expectedAmount: quote.finalSettlement,
        },
      });
      addToast({
        type: 'success',
        message: `Loan settled with ₹${quote.finalSettlement.toLocaleString('en-IN')} payment.`,
      });
      setConfirmOpen(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to record settlement');
      addToast({ type: 'error', message: msg });
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Calculator className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Final Settlement Quote</h2>
            <p className="text-xs text-muted-foreground">
              Pay this amount today to close the loan early.
            </p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm mb-4">
        <Row label="Unpaid installments" value={String(quote.unpaidCount)} />
        <Row label="Principal due" value={formatINR(quote.unpaidPrincipal)} />
        <Row label="File charge due" value={formatINR(quote.unpaidFileCharge)} />
        <Row
          label="Future interest waived"
          value={formatINR(quote.waivedInterest)}
          valueClass="text-emerald-700 dark:text-emerald-400"
        />
      </dl>

      <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 p-3 mb-4">
        <p className="text-xs text-muted-foreground mb-1">Customer pays today</p>
        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
          {formatINR(quote.finalSettlement)}
        </p>
      </div>

      {canSettle && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white',
            'hover:bg-emerald-700 transition-colors',
          )}
        >
          <Check className="h-4 w-4" />
          Settle Final Amount
        </button>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setConfirmOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-semibold mb-1">Record Final Settlement</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Customer will pay {formatINR(quote.finalSettlement)} to fully close the
              loan ({formatINR(quote.waivedInterest)} interest waived).
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Payment mode</label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Payment date</label>
                <input
                  type="date"
                  value={paymentDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Reference # (optional)
                </label>
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="UPI ref, cheque #, etc."
                  className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={settle.isPending}
                onClick={handleConfirm}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white',
                  'hover:bg-emerald-700 transition-colors disabled:opacity-60',
                )}
              >
                {settle.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Confirm Settlement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right font-medium', valueClass)}>{value}</dd>
    </>
  );
}
