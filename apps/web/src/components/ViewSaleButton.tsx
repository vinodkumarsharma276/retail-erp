import { ArrowUpRight, ReceiptIndianRupee } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { usePermission } from '../hooks/usePermission';

/**
 * Opens the original sale behind an installment. Tinted with the brand
 * colour so it reads as a link to another record, distinct from the
 * row's own actions (Pay, Promise). Stops the click from reaching the row,
 * which opens the installment history instead.
 */
export function ViewSaleButton({ saleId, className }: { saleId: string | undefined; className?: string }) {
  const navigate = useNavigate();
  const canOpen = usePermission('sales.detail');
  if (!saleId || !canOpen) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/sales/${saleId}`);
      }}
      title="Open the original sale"
      className={cn(
        'group/sale inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-xs font-semibold text-primary',
        'transition-colors hover:bg-primary hover:text-primary-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <ReceiptIndianRupee className="h-3.5 w-3.5" />
      View sale
      <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover/sale:-translate-y-px group-hover/sale:translate-x-px" />
    </button>
  );
}
