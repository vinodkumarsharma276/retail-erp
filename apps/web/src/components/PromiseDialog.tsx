import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, X } from 'lucide-react';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type { InstallmentPromiseRecord } from '@retailerp/shared-types';
import { useCreateInstallmentPromiseMutation, useInstallmentPromisesQuery } from '../hooks/useInstallments';
import { useToastStore } from '../stores/toast-store';
import { nextPromiseLabels, promiseLabel } from '../lib/promise-labels';
import { DateInput } from './DateInput';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

interface PromiseDialogProps {
  scheduleId: string;
  customerId: string;
  customerName?: string;
  /** EMIs on the sale; only unpaid ones can be promised. */
  installments: Array<{
    id: string;
    installmentNumber: number;
    dueDate: string;
    remainingAmount: number;
  }>;
  /** Pre-tick these EMIs. Defaults to every unpaid EMI due by today. */
  defaultCoveredIds?: string[];
  onClose: () => void;
  onCreated?: (promise: InstallmentPromiseRecord) => void;
}

function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "Customer will pay on <date>" with no money taken today. A promise is a
 * note: EMIs keep their due dates, nothing owed changes. It only keeps the
 * customer off the daily list until that date. Labelled the register way —
 * the k-th promise on EMI N is "N.k".
 */
export function PromiseDialog({
  scheduleId,
  customerId,
  customerName,
  installments,
  defaultCoveredIds,
  onClose,
  onCreated,
}: PromiseDialogProps) {
  const today = localTodayIso();
  const addToast = useToastStore((s) => s.addToast);
  const { data: promises } = useInstallmentPromisesQuery({ scheduleId });
  const mutation = useCreateInstallmentPromiseMutation();

  const unpaid = useMemo(
    () =>
      installments
        .filter((i) => Number(i.remainingAmount) > 0)
        .map((i) => ({ ...i, dueDate: i.dueDate.slice(0, 10), remainingAmount: Number(i.remainingAmount) }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber),
    [installments],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (defaultCoveredIds?.length) return defaultCoveredIds;
    const due = unpaid.filter((i) => i.dueDate <= today).map((i) => i.id);
    return due.length > 0 ? due : unpaid.slice(0, 1).map((i) => i.id);
  });
  const [promisedDate, setPromisedDate] = useState('');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [notes, setNotes] = useState('');

  const selected = unpaid.filter((i) => selectedIds.includes(i.id));
  const selectedTotal = Math.round(selected.reduce((s, i) => s + i.remainingAmount, 0) * 100) / 100;
  useEffect(() => {
    if (!amountTouched) setAmount(selectedTotal > 0 ? String(selectedTotal) : '');
  }, [selectedTotal, amountTouched]);

  const label = selected.length
    ? nextPromiseLabels(
        promises,
        selected.map((i) => ({ installmentId: i.id, installmentNumber: i.installmentNumber })),
      )
    : '';
  const replaces = (promises ?? []).filter(
    (p) => p.status === 'pending' && p.coveredInstallmentIds.some((id) => selectedIds.includes(id)),
  );

  const amountNum = Number(amount) || 0;
  const errors = [
    promisedDate && promisedDate < today ? "The date can't be in the past." : null,
    amountNum > selectedTotal + 0.5 ? `More than is owed on those EMIs (${formatINR(selectedTotal)}).` : null,
  ].filter(Boolean) as string[];
  const valid = !!promisedDate && selected.length > 0 && amountNum > 0 && errors.length === 0;

  const toggle = (id: string) =>
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const submit = () =>
    mutation.mutate(
      {
        scheduleId,
        customerId,
        coveredInstallmentIds: selectedIds,
        promisedDate,
        promisedAmount: amountNum,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (promise) => {
          addToast({ type: 'success', message: `Promise ${label} saved for ${formatDateIN(promisedDate)}` });
          onCreated?.(promise);
          onClose();
        },
      },
    );

  const mutationError = mutation.error
    ? (mutation.error as any)?.response?.data?.error ?? 'Could not save the promise.'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promise-title"
        className="animate-scale-in relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="promise-title" className="flex items-center gap-2 text-title">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Record promise
            </h3>
            <p className="text-caption">
              {customerName ? `${customerName} · ` : ''}no payment today
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="scrollbar-auto space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label required>For EMI</Label>
            {unpaid.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is owing on this sale.</p>
            ) : (
              <div className="mt-1 divide-y divide-border rounded-md border border-border">
                {unpaid.map((i) => {
                  const overdue = i.dueDate < today;
                  return (
                    <label key={i.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(i.id)}
                        onChange={() => toggle(i.id)}
                        className="h-4 w-4 rounded border-border-strong accent-[hsl(var(--primary))]"
                      />
                      <span className="font-medium">EMI #{i.installmentNumber}</span>
                      <span className={overdue ? 'text-destructive' : 'text-muted-foreground'}>
                        due {formatDateIN(i.dueDate)}
                      </span>
                      <span className="ml-auto tabular">{formatINR(i.remainingAmount)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>Will pay on</Label>
              <DateInput value={promisedDate} onChange={setPromisedDate} min={today} />
            </div>
            <div>
              <Label htmlFor="promise-amount" required>Amount</Label>
              <Input
                id="promise-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmount(e.target.value);
                }}
              />
            </div>
          </div>

          {label && (
            <div className="rounded-lg border border-border bg-subtle px-3 py-2 text-sm">
              Recorded as promise <span className="font-semibold tabular">{label}</span>
              {replaces.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Replaces {replaces.map((p) => `${promiseLabel(p)} (${formatDateIN(p.promisedDate)})`).join(', ')} —
                  kept in history, not counted as broken.
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Due dates don't move. The customer is left off the daily list until this date, except on the
                day another EMI falls due.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="promise-notes">Notes</Label>
            <Textarea
              id="promise-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What the customer said (optional)"
            />
          </div>

          {[...errors, ...(mutationError ? [mutationError] : [])].map((message) => (
            <div
              key={message}
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {message}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={mutation.isPending} disabled={!valid}>
            Save promise
          </Button>
        </div>
      </div>
    </div>
  );
}
