import { useState } from 'react';
import { AlertTriangle, Merge, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { formatINR } from '@retailerp/shared-utils';
import type { DistributorListItem } from '@retailerp/shared-types';

interface MergeDistributorsDialogProps {
  /** The ticked suppliers, in the order the table showed them. */
  candidates: DistributorListItem[];
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (targetId: string) => void;
}

/**
 * Choosing which of the ticked suppliers to keep.
 *
 * The merge itself is not reversible, so the choice is deliberately a
 * one-at-a-time pick rather than a dropdown: the names being folded together
 * are near-identical by definition, and the whole point is to look at them
 * side by side before committing. What each one is bringing with it is shown
 * next to it, because that is what decides which record is the real one.
 */
export function MergeDistributorsDialog({
  candidates,
  loading = false,
  onCancel,
  onConfirm,
}: MergeDistributorsDialogProps) {
  useEscapeKey(true, () => {
    if (!loading) onCancel();
  });

  // Nothing is preselected: picking the keeper is the decision being made,
  // and a default here is the one a tired user would accept without reading.
  const [targetId, setTargetId] = useState<string | null>(null);

  const losing = candidates.filter((d) => d.id !== targetId);
  const movingProducts = losing.reduce((n, d) => n + d.totalProductsPurchased, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onCancel} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-distributors-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-popover shadow-lg"
      >
        <header className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 id="merge-distributors-title" className="text-lg font-semibold">
              Merge {candidates.length} distributors
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Which one is the real record? The others fold into it.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ul className="space-y-2">
            {candidates.map((d) => {
              const isTarget = d.id === targetId;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setTargetId(d.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      isTarget
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/50 hover:bg-muted/50',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        isTarget ? 'border-primary' : 'border-muted-foreground/40',
                      )}
                      aria-hidden
                    >
                      {isTarget && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.companyName}</span>
                        {isTarget && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                            Keep this one
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {d.contactPerson}
                        {d.phone ? ` · ${d.phone}` : ''}
                        {d.gstNumber ? ` · GST ${d.gstNumber}` : ''}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {d.totalProductsPurchased} product
                        {d.totalProductsPurchased === 1 ? '' : 's'} · pending{' '}
                        {formatINR(d.pendingPayment)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {targetId && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium">This cannot be undone.</p>
                <p className="mt-0.5 text-muted-foreground">
                  {losing.length} supplier{losing.length === 1 ? '' : 's'} will be deleted.
                  Their {movingProducts} product{movingProducts === 1 ? '' : 's'}, every
                  purchase recorded against them, and the categories they supply move to{' '}
                  <span className="font-medium text-foreground">
                    {candidates.find((d) => d.id === targetId)?.companyName}
                  </span>
                  . No money or stock is lost — it only changes hands.
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t px-5 py-4">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={() => targetId && onConfirm(targetId)}
            disabled={!targetId || loading}
            loading={loading}
          >
            <Merge className="mr-1.5 h-4 w-4" />
            Merge
          </Button>
        </footer>
      </div>
    </div>
  );
}
