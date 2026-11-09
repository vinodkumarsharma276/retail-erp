import { formatINR } from '@retailerp/shared-utils';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useClearPaymentsMutation, useClearPaymentsPreviewQuery } from '../../hooks/useDistributors';
import { useToast } from '../../stores/toast-store';

/**
 * Owner-only "Clear payments" for one supplier (detail page) or the ones ticked on the list.
 * Every payment and advance is deleted and every bill marked settled, in all shops, so both
 * Total paid and Pending go to ₹0. Shows what will go before anything happens.
 */
export function ClearPaymentsDialog({
  ids,
  open,
  onClose,
  onDone,
}: {
  ids: string[];
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const preview = useClearPaymentsPreviewQuery(ids, open);
  const clear = useClearPaymentsMutation();
  const p = preview.data;
  const nothing = !!p && p.paid === 0 && p.pending === 0 && p.bills === 0 && p.advances === 0;
  const single = ids.length === 1;

  const message = (() => {
    if (preview.isError) return 'Could not check what is recorded. Close this and try again.';
    if (preview.isLoading || !p) return 'Checking what is recorded…';
    if (nothing) return 'Nothing is paid or pending for this selection — Total paid and Pending are already ₹0.';
    const lines = [
      `Total paid ${formatINR(p.paid)} → ₹0\nPending ${formatINR(p.pending)} → ₹0`,
      !single && p.suppliers.length > 0
        ? p.suppliers
            .filter((s) => s.paid > 0 || s.pending > 0)
            .slice(0, 8)
            .map((s) => `• ${s.supplier}: paid ${formatINR(s.paid)}, pending ${formatINR(s.pending)}`)
            .join('\n') + (p.suppliers.length > 8 ? `\n…and ${p.suppliers.length - 8} more` : '')
        : '',
      `All ${p.payments} payment${p.payments === 1 ? '' : 's'}${p.advances ? ` and ${p.advances} advance${p.advances === 1 ? '' : 's'}` : ''} are deleted and ${p.bills} bill${p.bills === 1 ? ' is' : 's are'} marked "Settled", in every shop. The bills and stock stay; new bills start a fresh balance.`,
      'This cannot be undone.',
    ];
    return lines.filter(Boolean).join('\n\n');
  })();

  return (
    <ConfirmDialog
      isOpen={open}
      variant="danger"
      title={single ? `Clear ${p?.suppliers[0]?.supplier ?? 'this supplier'}'s payments?` : `Clear payments of ${ids.length} distributors?`}
      message={message}
      confirmText={nothing || preview.isError ? 'Close' : 'Clear payments'}
      loading={clear.isPending || preview.isLoading}
      onCancel={onClose}
      onConfirm={async () => {
        if (nothing || preview.isError) return onClose();
        try {
          const res = await clear.mutateAsync(ids);
          toast.success(
            `Cleared ${res.suppliers} distributor${res.suppliers === 1 ? '' : 's'}: Total paid and Pending are now ₹0`,
          );
          onClose();
          onDone?.();
        } catch (error: any) {
          toast.error(error?.response?.data?.error || error?.message || 'Failed to clear payments');
        }
      }}
    />
  );
}
