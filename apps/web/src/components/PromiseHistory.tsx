import { useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type { InstallmentPromiseRecord, InstallmentPromiseStatus } from '@retailerp/shared-types';
import { cn } from '../lib/utils';
import { promiseLabel } from '../lib/promise-labels';
import { useCancelInstallmentPromiseMutation } from '../hooks/useInstallments';
import { useToastStore } from '../stores/toast-store';
import { Button } from './ui/button';
import { Input } from './ui/input';

export const PROMISE_STATUS: Record<InstallmentPromiseStatus, { label: string; className: string }> = {
  pending: { label: 'Waiting', className: 'border-primary/30 bg-primary-muted text-primary' },
  kept: { label: 'Kept', className: 'border-success/30 bg-success-muted text-success' },
  partially_kept: { label: 'Part kept', className: 'border-warning/30 bg-warning-muted text-warning' },
  broken: { label: 'Broken', className: 'border-destructive/30 bg-destructive-muted text-destructive' },
  replaced: { label: 'New date given', className: 'border-border bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'border-border bg-muted text-muted-foreground line-through' },
};

function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A pending promise whose date has gone by is already broken in practice —
 * the nightly job just hasn't marked it yet. Show it that way.
 */
export function effectivePromiseStatus(promise: InstallmentPromiseRecord): InstallmentPromiseStatus {
  if (promise.status === 'pending' && promise.promisedDate.slice(0, 10) < localTodayIso()) return 'broken';
  return promise.status;
}

export function PromiseChip({ promise, className }: { promise: InstallmentPromiseRecord; className?: string }) {
  const status = PROMISE_STATUS[effectivePromiseStatus(promise)];
  return (
    <span
      title={promise.notes ?? undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        status.className,
        className,
      )}
    >
      <span className="tabular">{promiseLabel(promise) || '—'}</span>
      <span className="opacity-60">·</span>
      {formatDateIN(promise.promisedDate)}
      <span className="opacity-60">·</span>
      {status.label}
    </span>
  );
}

/** Every promise on a sale, newest first, with register labels and outcomes. */
export function PromiseHistory({
  promises,
  onAdd,
  canCancel,
}: {
  promises: InstallmentPromiseRecord[];
  onAdd?: () => void;
  canCancel?: boolean;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const cancelMutation = useCancelInstallmentPromiseMutation();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const ordered = [...promises].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="rounded-lg border bg-card p-6 mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-medium">Promises</h2>
          <span className="text-caption">1.1 = first promise on EMI 1</span>
        </div>
        {onAdd && (
          <Button variant="outline" size="sm" onClick={onAdd}>
            Record promise
          </Button>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No promises on this sale.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">Promise</th>
                <th className="px-2 py-2 font-medium">Will pay on</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 text-right font-medium">Received</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Recorded</th>
                <th className="px-2 py-2 font-medium">Notes</th>
                {canCancel && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {ordered.map((promise) => {
                const status = PROMISE_STATUS[effectivePromiseStatus(promise)];
                return (
                  <tr key={promise.id} className="border-b last:border-0 align-top">
                    <td className="px-2 py-2 font-semibold tabular">{promiseLabel(promise) || '—'}</td>
                    <td className="px-2 py-2">{formatDateIN(promise.promisedDate)}</td>
                    <td className="px-2 py-2 text-right tabular">{formatINR(Number(promise.promisedAmount))}</td>
                    <td className="px-2 py-2 text-right tabular text-muted-foreground">
                      {promise.status === 'pending' ? '—' : formatINR(Number(promise.collectedAmount))}
                    </td>
                    <td className="px-2 py-2">
                      <span className={cn('inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium', status.className)}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{formatDateIN(promise.createdAt)}</td>
                    <td className="max-w-[16rem] whitespace-pre-line px-2 py-2 text-xs text-muted-foreground">
                      {promise.notes || '—'}
                    </td>
                    {canCancel && (
                      <td className="px-2 py-2">
                        {promise.status === 'pending' &&
                          (cancelling === promise.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Why?"
                                className="h-7 w-32 text-xs"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                loading={cancelMutation.isPending}
                                onClick={() =>
                                  cancelMutation.mutate(
                                    { promiseId: promise.id, reason: reason.trim() || undefined },
                                    {
                                      onSuccess: () => {
                                        addToast({ type: 'success', message: 'Promise cancelled' });
                                        setCancelling(null);
                                        setReason('');
                                      },
                                      onError: (err: unknown) =>
                                        addToast({
                                          type: 'error',
                                          message:
                                            (err as { response?: { data?: { error?: string } } })?.response?.data
                                              ?.error ?? 'Could not cancel',
                                        }),
                                    },
                                  )
                                }
                              >
                                Cancel it
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label="Keep" onClick={() => setCancelling(null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setCancelling(promise.id)}
                              className="text-xs text-muted-foreground hover:text-destructive"
                              title="Entered by mistake — cancelled promises don't count against the customer"
                            >
                              Cancel
                            </button>
                          ))}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
