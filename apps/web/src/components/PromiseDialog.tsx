import { useMemo, useState } from 'react';
import { CalendarDays, Loader2, X } from 'lucide-react';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { cn } from '../lib/utils';
import { useCreateInstallmentPromiseMutation } from '../hooks/useInstallments';
import type { InstallmentPromiseRecord } from '@retailerp/shared-types';

interface PromiseDialogProps {
  scheduleId: string;
  customerId: string;
  installments: Array<{
    id: string;
    installmentNumber: number;
    dueDate: string;
    remainingAmount: number;
    status: string;
  }>;
  onClose: () => void;
  onCreated: (promise: InstallmentPromiseRecord) => void;
}

export function PromiseDialog({ scheduleId, customerId, installments, onClose, onCreated }: PromiseDialogProps) {
  const unpaid = installments.filter((installment) => Number(installment.remainingAmount) > 0);
  const [selectedIds, setSelectedIds] = useState<string[]>(unpaid[0] ? [unpaid[0].id] : []);
  const [promisedDate, setPromisedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const selectedTotal = useMemo(
    () => unpaid.filter((installment) => selectedIds.includes(installment.id)).reduce((sum, installment) => sum + Number(installment.remainingAmount), 0),
    [selectedIds, unpaid],
  );
  const [promisedAmount, setPromisedAmount] = useState('');
  const [notes, setNotes] = useState('');
  const mutation = useCreateInstallmentPromiseMutation();
  const amountValue = Number(promisedAmount || selectedTotal);

  const toggle = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const submit = () => {
    mutation.mutate({
      scheduleId,
      customerId,
      coveredInstallmentIds: selectedIds,
      promisedDate,
      promisedAmount: amountValue,
      notes: notes.trim() || undefined,
    }, {
      onSuccess: (promise) => {
        onCreated(promise);
        onClose();
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <CalendarDays className="h-4 w-4" /> Add Promise
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <label className="block text-sm">
            <span className="font-medium">Promise date</span>
            <input
              type="date"
              value={promisedDate}
              onChange={(event) => setPromisedDate(event.target.value)}
              className="mt-1 w-full rounded-md border bg-field px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium">Promised amount</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={promisedAmount}
              placeholder={String(selectedTotal)}
              onChange={(event) => setPromisedAmount(event.target.value)}
              className="mt-1 w-full rounded-md border bg-field px-3 py-2"
            />
            <span className="mt-1 block text-xs text-muted-foreground">Selected EMI total: {formatINR(selectedTotal)}</span>
          </label>

          <div>
            <div className="mb-2 text-sm font-medium">Covers installments</div>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
              {unpaid.map((installment) => (
                <label key={installment.id} className={cn('flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted', selectedIds.includes(installment.id) && 'bg-muted')}>
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={selectedIds.includes(installment.id)} onChange={() => toggle(installment.id)} />
                    EMI #{installment.installmentNumber}
                  </span>
                  <span className="text-muted-foreground">{formatDateIN(installment.dueDate)} · {formatINR(Number(installment.remainingAmount))}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-medium">Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border bg-field px-3 py-2" />
          </label>

          {mutation.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(mutation.error as any)?.response?.data?.error ?? 'Failed to create promise'}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} type="button" className="rounded-md border px-3 py-2 text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={selectedIds.length === 0 || amountValue <= 0 || mutation.isPending}
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Promise
          </button>
        </div>
      </div>
    </div>
  );
}
