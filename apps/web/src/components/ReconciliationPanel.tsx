import { useState } from 'react';
import {
  X,
  Loader2,
  AlertCircle,
  Link2,
  FileText,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  useSuggestedMatchesQuery,
  useReconcileTransactionMutation,
  useManualReconcileMutation,
} from '../hooks/useBank';
import type { BankTransaction, SuggestedMatch } from '../hooks/useBank';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { StatusBadge } from './StatusBadge';
import { useEscapeKey } from '../hooks/useEscapeKey';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ReconciliationPanelProps {
  transaction: BankTransaction;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Match type labels
// ---------------------------------------------------------------------------
const MATCH_TYPE_LABELS: Record<string, string> = {
  sale: 'Sale',
  purchase_payment: 'Purchase Payment',
  expense: 'Expense',
  installment: 'Installment',
  sale_payment: 'Sale Payment',
};

// ---------------------------------------------------------------------------
// Confidence indicator
// ---------------------------------------------------------------------------
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color = 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30';
  if (pct >= 80) color = 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30';
  else if (pct >= 50) color = 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        color,
      )}
    >
      {pct}% match
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ReconciliationPanel({
  transaction,
  onClose,
}: ReconciliationPanelProps) {
  useEscapeKey(true, onClose);

  const [manualNotes, setManualNotes] = useState('');
  const [reconciled, setReconciled] = useState(false);

  const suggestionsQuery = useSuggestedMatchesQuery(transaction.id);
  const reconcileMutation = useReconcileTransactionMutation();
  const manualReconcileMutation = useManualReconcileMutation();

  const suggestions = suggestionsQuery.data ?? [];

  // Auto-match handler
  const handleMatch = (suggestion: SuggestedMatch) => {
    reconcileMutation.mutate(
      {
        transactionId: transaction.id,
        reconciledWithType: suggestion.type,
        reconciledWithId: suggestion.referenceId,
      },
      {
        onSuccess: () => {
          setReconciled(true);
        },
      },
    );
  };

  // Manual match handler
  const handleManualMatch = () => {
    if (!manualNotes.trim()) return;
    manualReconcileMutation.mutate(
      {
        transactionId: transaction.id,
        notes: manualNotes.trim(),
      },
      {
        onSuccess: () => {
          setReconciled(true);
        },
      },
    );
  };

  const mutationError =
    reconcileMutation.error || manualReconcileMutation.error;
  const errorMessage = mutationError
    ? (mutationError as any)?.response?.data?.error ??
      (mutationError as any)?.response?.data?.message ??
      'Reconciliation failed. Please try again.'
    : null;

  const isProcessing =
    reconcileMutation.isPending || manualReconcileMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Side panel */}
      <div className="relative z-10 w-full max-w-lg h-full overflow-y-auto bg-card border-l shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-medium">Reconcile Transaction</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Transaction details */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Date</span>
              <span className="text-sm font-medium">
                {formatDateIN(transaction.transactionDate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span
                className={cn(
                  'text-sm font-semibold',
                  transaction.type === 'debit'
                    ? 'text-red-600'
                    : 'text-green-600',
                )}
              >
                {transaction.type === 'debit' ? '-' : '+'}
                {formatINR(transaction.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Type</span>
              <span className="text-sm font-medium capitalize">
                {transaction.type}
              </span>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Description</span>
              <p className="text-sm mt-0.5">{transaction.description}</p>
            </div>
            {transaction.referenceNumber && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Reference</span>
                <span className="text-sm font-mono">
                  {transaction.referenceNumber}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <StatusBadge status={transaction.reconciliationStatus} />
            </div>
          </div>

          {/* Success state */}
          {reconciled && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
              <h4 className="text-lg font-medium">Transaction Reconciled</h4>
              <p className="text-sm text-muted-foreground">
                This transaction has been successfully matched.
              </p>
              <button
                onClick={onClose}
                className={cn(
                  'rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                )}
              >
                Close
              </button>
            </div>
          )}

          {/* Only show match options if not yet reconciled */}
          {!reconciled && (
            <>
              {/* Suggested Matches */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Suggested Matches
                </h4>

                {suggestionsQuery.isLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Finding matches...
                    </span>
                  </div>
                )}

                {suggestionsQuery.isError && (
                  <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Failed to load suggestions.
                  </div>
                )}

                {!suggestionsQuery.isLoading &&
                  !suggestionsQuery.isError &&
                  suggestions.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No matching records found. Use manual match below.
                    </p>
                  )}

                {suggestions.length > 0 && (
                  <div className="space-y-3">
                    {suggestions.map((suggestion, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                {MATCH_TYPE_LABELS[suggestion.type] ??
                                  suggestion.type}
                              </span>
                              <ConfidenceBadge
                                confidence={suggestion.confidence}
                              />
                            </div>
                            <p className="text-sm font-medium">
                              {suggestion.reference}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {suggestion.description}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>
                                {formatDateIN(suggestion.date)}
                              </span>
                              <span className="font-medium text-foreground">
                                {formatINR(suggestion.amount)}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleMatch(suggestion)}
                            disabled={isProcessing}
                            className={cn(
                              'flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground',
                              'hover:bg-primary-hover transition-colors',
                              'disabled:opacity-50 disabled:cursor-not-allowed',
                            )}
                          >
                            {reconcileMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ArrowRight className="h-3.5 w-3.5" />
                            )}
                            Match
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t" />
                <span className="text-xs text-muted-foreground">OR</span>
                <div className="flex-1 border-t" />
              </div>

              {/* Manual Match */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Manual Match
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  If no suggested match fits, manually mark this transaction
                  with a note explaining its purpose.
                </p>
                <textarea
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Cash deposit for daily sales, ATM withdrawal for petty cash..."
                  className={cn(
                    'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
                <button
                  onClick={handleManualMatch}
                  disabled={
                    !manualNotes.trim() ||
                    manualReconcileMutation.isPending ||
                    isProcessing
                  }
                  className={cn(
                    'mt-3 flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white',
                    'hover:bg-blue-700 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {manualReconcileMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Mark as Manual Match'
                  )}
                </button>
              </div>

              {/* Error */}
              {errorMessage && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {errorMessage}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
