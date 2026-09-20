import { X, Loader2 } from 'lucide-react';
import { useProductsQuery } from '../hooks/useProducts';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type { Product } from '@retailerp/shared-types';

interface SerialPickerDialogProps {
  open: boolean;
  title: string;
  actionLabel: string;
  brand: string;
  modelNumber: string;
  categoryId: string;
  shopId?: string;
  onPick: (productId: string) => void;
  onClose: () => void;
}

/**
 * Lists every in-stock unit for a (brand, model, category[, shop]) tuple
 * so the user can pick the specific serial they want to sell / transfer.
 */
export function SerialPickerDialog({
  open,
  title,
  actionLabel,
  brand,
  modelNumber,
  categoryId,
  shopId: _shopId,
  onPick,
  onClose,
}: SerialPickerDialogProps) {
  const q = useProductsQuery({
    page: 1,
    pageSize: 200,
    categoryId,
    status: 'in_stock',
    search: modelNumber,
  });

  if (!open) return null;

  // Narrow to the exact brand+model since `search` is fuzzy.
  const units: Product[] = (q.data?.data ?? []).filter(
    (p) =>
      p.brand?.toLowerCase() === brand.toLowerCase() &&
      p.modelNumber?.toLowerCase() === modelNumber.toLowerCase(),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {brand} {modelNumber} — pick which unit to {actionLabel.toLowerCase()}.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {q.isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading units…
            </div>
          ) : units.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No in-stock units found for this model.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2 py-2 text-left">Serial / IMEI</th>
                  <th className="px-2 py-2 text-left">Purchase Date</th>
                  <th className="px-2 py-2 text-right">MRP</th>
                  <th className="px-2 py-2 text-right">DP</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => {
                  const purchase = (u as any).purchase as { invoiceDate?: string } | null;
                  return (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="px-2 py-2 font-mono text-xs">{u.serialNumber || '-'}</td>
                      <td className="px-2 py-2">
                        {purchase?.invoiceDate ? formatDateIN(purchase.invoiceDate) : '-'}
                      </td>
                      <td className="px-2 py-2 text-right">{formatINR(u.mrp)}</td>
                      <td className="px-2 py-2 text-right">{formatINR(u.purchasePrice)}</td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => onPick(u.id)}
                          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          {actionLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end border-t px-5 py-3">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
