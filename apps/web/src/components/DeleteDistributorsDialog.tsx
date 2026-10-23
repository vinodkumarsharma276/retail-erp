import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { DistributorDeletionImpact } from '../hooks/useDistributors';

interface DeleteDistributorsDialogProps {
  /** Null while the counts are still being fetched. */
  impact: DistributorDeletionImpact[] | null;
  loading?: boolean;
  onCancel: () => void;
  /** `cascade` true when invoices and stock are going too. */
  onConfirm: (cascade: boolean) => void;
}

/** The word typed to confirm a cascade. Short, and not a word typed by habit. */
const CONFIRM_WORD = 'DELETE';

/**
 * Confirming a supplier delete, with what goes down with it.
 *
 * A supplier that has traded cannot be removed on its own —
 * `purchases.distributor_id` is NOT NULL, so its invoices must go, and an
 * invoice takes the units it brought in. That is a much bigger act than the
 * button implies, so the counts are fetched and spelled out first, and
 * anything beyond the supplier record itself has to be typed for.
 */
export function DeleteDistributorsDialog({
  impact,
  loading = false,
  onCancel,
  onConfirm,
}: DeleteDistributorsDialogProps) {
  useEscapeKey(true, () => {
    if (!loading) onCancel();
  });

  const [typed, setTyped] = useState('');

  const withHistory = (impact ?? []).filter((d) => d.purchases > 0 || d.products > 0);
  const cascade = withHistory.length > 0;
  const invoices = withHistory.reduce((n, d) => n + d.purchases, 0);
  const units = withHistory.reduce((n, d) => n + d.products, 0);
  const canConfirm = !cascade || typed.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onCancel} />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-distributors-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-lg"
      >
        <header className="flex items-start justify-between border-b px-5 py-4">
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h2 id="delete-distributors-title" className="text-lg font-semibold">
                Delete {impact?.length ?? 0} distributor
                {(impact?.length ?? 0) === 1 ? '' : 's'}?
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {cascade
                  ? 'Their invoices and the stock those brought in go too.'
                  : 'Nothing was ever bought from these, so only the records go.'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {impact === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Working out what this would take with it...
            </div>
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {impact.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{d.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.purchases === 0 && d.products === 0
                        ? 'nothing attached'
                        : `${d.purchases} invoice${d.purchases === 1 ? '' : 's'} · ${d.products} unit${d.products === 1 ? '' : 's'}`}
                    </span>
                  </li>
                ))}
              </ul>

              {cascade && (
                <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
                  <p className="font-medium text-destructive">
                    This destroys {invoices} invoice{invoices === 1 ? '' : 's'} and {units} unit
                    {units === 1 ? '' : 's'} of stock.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Purchase history for these suppliers is gone for good, and the stock they
                    brought in leaves your inventory. It stops if any unit has been sold or
                    transferred, or if any invoice has money recorded against it. To keep the
                    stock and only lose the duplicate name, merge instead.
                  </p>

                  <label className="mt-3 block">
                    <span className="text-xs font-medium text-foreground">
                      Type {CONFIRM_WORD} to confirm
                    </span>
                    <Input
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder={CONFIRM_WORD}
                      autoFocus
                      className="mt-1"
                    />
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t px-5 py-4">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(cascade)}
            disabled={impact === null || !canConfirm || loading}
            loading={loading}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {cascade ? 'Delete everything' : 'Delete'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
