import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useCanCheck } from '../../../hooks/usePermission';
import { api, type DeleteImpact, type UndoneSupplierPayments } from '../lib/api';
import { count, money } from '../lib/format';
import { useInvalidateData } from '../lib/queries';
import { ConfirmDialog, Spinner, useToast } from './ui';

/** What is being deleted: some bank rows, or a whole statement. */
export type DeleteTarget = { kind: 'rows'; ids: string[] } | { kind: 'statement'; id: string; fileName: string };

/**
 * Confirm deleting bank rows or a statement. Rows that were recorded as supplier payments take
 * those payments with them — the bills they paid are unpaid again, advances are removed — so the
 * dialog loads that first and names every supplier and amount before anything is touched.
 */
export function DeleteTransactionsDialog({
  target,
  onCancel,
  onDeleted,
}: {
  target: DeleteTarget | null;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const canUndoPayments = useCanCheck()('purchases.record_payment');

  const impact = useQuery({
    queryKey: ['bank-delete-impact', target],
    queryFn: (): Promise<DeleteImpact> =>
      target!.kind === 'statement' ? api.statementDeleteImpact(target!.id) : api.transactionsDeleteImpact(target!.ids),
    enabled: !!target,
    staleTime: 0,
    gcTime: 0,
  });

  const del = useMutation({
    mutationFn: async (): Promise<{ undone: UndoneSupplierPayments; removed: string }> => {
      if (target!.kind === 'statement') {
        const r = await api.deleteStatement(target!.id);
        return { undone: r.supplierPayments, removed: 'Statement deleted' };
      }
      const r = await api.deleteTransactions(target!.ids);
      const rows = `${count(r.deleted)} transaction${r.deleted === 1 ? '' : 's'} deleted`;
      return { undone: r.supplierPayments, removed: r.statementsRemoved ? `${rows} · ${r.statementsRemoved} empty statement removed` : rows };
    },
    onSuccess: ({ undone, removed }) => {
      toast(undone.amount > 0 ? `${removed} · ${money(undone.amount)} of supplier payments undone` : removed, 'good');
      invalidate();
      if (undone.amount > 0) {
        qc.invalidateQueries({ queryKey: ['distributors'] });
        qc.invalidateQueries({ queryKey: ['purchases'] });
      }
      onDeleted?.();
    },
    onError: (e: Error) => toast(e.message, 'critical'),
  });

  const linked = impact.data?.supplierPayments ?? [];
  const n = impact.data?.transactions ?? (target?.kind === 'rows' ? target.ids.length : 0);
  const blocked = linked.length > 0 && !canUndoPayments;

  return (
    <ConfirmDialog
      open={!!target}
      title={target?.kind === 'statement' ? 'Delete this statement?' : `Delete ${count(n)} transaction${n === 1 ? '' : 's'}?`}
      body={
        <div className="space-y-3">
          <p>
            {target?.kind === 'statement' ? (
              <>
                <b>{target.fileName}</b> and its {count(n)} transactions — including any review notes — will be permanently removed. You can
                upload the file again afterwards.
              </>
            ) : (
              <>
                {n === 1 ? 'This bank entry' : 'These bank entries'} will be permanently removed, and the statement's totals adjusted. A statement
                left with no entries is removed too.
              </>
            )}
          </p>
          {impact.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Checking for supplier payments…
            </div>
          )}
          {linked.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <AlertTriangle className="size-4 text-warning" />
                Supplier payments recorded from {n === 1 ? 'this entry' : 'these entries'} will be undone
              </div>
              <ul className="mt-2 space-y-1">
                {linked.map((p) => (
                  <li key={`${p.distributor_id}-${p.shop_name}`}>
                    <b>{money(p.amount)}</b> paid to <b>{p.supplier}</b> ({p.shop_name})
                    {p.bills > 0 && <> — {count(p.bills)} bill{p.bills === 1 ? ' goes' : 's go'} back to unpaid</>}
                    {p.advance > 0 && <> — advance of {money(p.advance)} removed</>}
                  </li>
                ))}
              </ul>
              {blocked && (
                <p className="mt-2 text-destructive">You are not allowed to remove supplier payments, so this can't be deleted. Ask the owner.</p>
              )}
            </div>
          )}
        </div>
      }
      confirmLabel={linked.length > 0 ? 'Delete and undo payments' : 'Delete'}
      danger
      loading={del.isPending || impact.isLoading}
      onConfirm={() => !blocked && !impact.isLoading && del.mutate()}
      onCancel={onCancel}
    />
  );
}
