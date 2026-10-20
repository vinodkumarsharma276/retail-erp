import { useState } from 'react';
import { useParams,  useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  Pencil,
  Trash2,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  X,
  ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePurchaseDetailQuery } from '../../hooks/usePurchases';
import {
  useRecordPurchasePaymentMutation,
  useUpdatePurchaseMutation,
  useDeletePurchasesMutation,
} from '../../hooks/usePurchases';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { useToast } from '../../stores/toast-store';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { PaymentMode } from '@retailerp/shared-types';
import type { PurchaseProduct, PurchasePayment } from '@retailerp/shared-types';
import { usePermission } from '../../hooks/usePermission';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// ---------------------------------------------------------------------------
// Payment form values
// ---------------------------------------------------------------------------
interface PaymentFormValues {
  amount: number | '';
  paymentMode: string;
  paymentDate: string;
  referenceNumber: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const canRecordPayment = usePermission('purchases.record_payment');
  const canEdit = usePermission('purchases.edit');
  const canDelete = usePermission('purchases.delete');
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteMut = useDeletePurchasesMutation();

  const { data: purchase, isLoading, isError } = usePurchaseDetailQuery(id);

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !purchase) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Purchase Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The purchase you are looking for does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchases
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-display">
              Purchase #{purchase.invoiceNumber}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={purchase.paymentStatus} />
              <span className="text-sm text-muted-foreground">
                {formatDateIN(purchase.invoiceDate)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <EditPurchaseDialog
          purchase={purchase}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast.success('Purchase updated.');
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deleting}
        title={`Delete purchase ${purchase.invoiceNumber}?`}
        message={`The ${purchase.products?.length ?? 0} unit(s) this purchase brought in are deleted with it. If any has been sold or transferred, nothing is deleted.`}
        confirmText="Delete"
        variant="danger"
        loading={deleteMut.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          deleteMut.mutate([purchase.id], {
            onSuccess: (result) => {
              toast.success(`Deleted the purchase and ${result.units} unit(s).`);
              navigate('/purchases');
            },
            onError: (error) => {
              const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
              toast.error(
                e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Could not delete.',
              );
              setDeleting(false);
            },
          });
        }}
      />

      {/* Invoice info card */}
      <div className="rounded-lg border bg-card p-6 mb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoRow label="Invoice Number" value={purchase.invoiceNumber} />
          <InfoRow label="Invoice Date" value={formatDateIN(purchase.invoiceDate)} />
          <InfoRow
            label="Distributor"
            value={purchase.distributor?.companyName ?? '-'}
          />
          <InfoRow
            label="Contact"
            value={
              purchase.distributor
                ? `${purchase.distributor.contactPerson} (${purchase.distributor.phone})`
                : '-'
            }
          />
          <InfoRow label="Total Amount" value={formatINR(purchase.totalAmount)} />
          <InfoRow label="GST" value={formatINR(purchase.gstAmount)} />
          <InfoRow label="Discount" value={formatINR(purchase.discountAmount)} />
          <InfoRow label="Net Amount" value={formatINR(purchase.netAmount)} />
          <InfoRow label="Amount Paid" value={formatINR(purchase.amountPaid)} />
          <InfoRow
            label="Pending"
            value={formatINR((Number(purchase.netAmount) || 0) - (Number(purchase.amountPaid) || 0))}
            highlight={(Number(purchase.netAmount) || 0) - (Number(purchase.amountPaid) || 0) > 0}
          />
          {purchase.notes && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-sm font-medium text-muted-foreground">Notes</p>
              <p className="mt-0.5 text-sm">{purchase.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Products section */}
      <div className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">
          Products ({purchase.products?.length ?? 0})
        </h2>
        {!purchase.products || purchase.products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products in this purchase.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    #
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Brand
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Serial Number
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    MRP
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Selling Price
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Purchase Price
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchase.products.map((product: PurchaseProduct, idx: number) => (
                  <tr
                    key={product.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/products/${product.id}`)}
                  >
                    <td className="px-4 py-3">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium">{product.brand}</td>
                    <td className="px-4 py-3">{product.modelNumber}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">
                        {product.serialNumber ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatINR(product.mrp)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatINR(product.sellingPrice)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatINR(product.purchasePrice)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={(product as any).status ?? 'in_stock'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment history section */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Payment History</h2>
          {canRecordPayment && purchase.paymentStatus !== 'paid' && (
            <button
              onClick={() => setShowPaymentDialog(true)}
              className={cn(
                'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
              )}
            >
              <Plus className="h-4 w-4" />
              Record Payment
            </button>
          )}
        </div>

        {!purchase.payments || purchase.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    #
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Mode
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Reference
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchase.payments.map((payment: PurchasePayment, idx: number) => (
                  <tr
                    key={payment.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">{idx + 1}</td>
                    <td className="px-4 py-3">
                      {formatDateIN(payment.paymentDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">
                      {formatINR(payment.amount)}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {payment.paymentMode.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3">{payment.referenceNumber ?? '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {payment.notes ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Dialog (modal overlay) */}
      {showPaymentDialog && (
        <RecordPaymentDialog
          purchaseId={id!}
          pendingAmount={(Number(purchase.netAmount) || 0) - (Number(purchase.amountPaid) || 0)}
          onClose={() => setShowPaymentDialog(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record Payment Dialog
// ---------------------------------------------------------------------------
function RecordPaymentDialog({
  purchaseId,
  pendingAmount,
  onClose,
}: {
  purchaseId: string;
  pendingAmount: number;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);

  const recordPaymentMutation = useRecordPurchasePaymentMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    defaultValues: {
      amount: '',
      paymentMode: PaymentMode.BANK_TRANSFER,
      paymentDate: new Date().toISOString().split('T')[0],
      referenceNumber: '',
      notes: '',
    },
  });

  const onSubmit = (formData: PaymentFormValues) => {
    recordPaymentMutation.mutate(
      {
        purchaseId,
        payload: {
          amount: Number(formData.amount),
          paymentMode: formData.paymentMode as PaymentMode,
          paymentDate: formData.paymentDate,
          referenceNumber: formData.referenceNumber.trim() || undefined,
          notes: formData.notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  const mutationError = recordPaymentMutation.error
    ? (recordPaymentMutation.error as any)?.response?.data?.error ??
      (recordPaymentMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Record Payment</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Pending amount: <span className="font-semibold text-red-600">{formatINR(pendingAmount)}</span>
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Amount */}
          <div>
            <label htmlFor="pay-amount" className="block text-sm font-medium mb-1.5">
              Amount <span className="text-destructive">*</span>
            </label>
            <input
              id="pay-amount"
              type="number"
              step="0.01"
              {...register('amount', {
                required: 'Amount is required',
                min: { value: 0.01, message: 'Amount must be greater than 0' },
                max: {
                  value: pendingAmount,
                  message: `Amount cannot exceed pending amount (${formatINR(pendingAmount)})`,
                },
              })}
              placeholder="0.00"
              className={cn(
                'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.amount && 'border-destructive',
              )}
            />
            {errors.amount && (
              <p className="mt-1 text-xs text-destructive">
                {errors.amount.message}
              </p>
            )}
          </div>

          {/* Payment Mode */}
          <div>
            <label htmlFor="pay-mode" className="block text-sm font-medium mb-1.5">
              Payment Mode <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <select
                id="pay-mode"
                {...register('paymentMode', {
                  required: 'Payment mode is required',
                })}
                className={cn(
                  'w-full appearance-none rounded-md border bg-field px-3 py-2.5 pr-8 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value={PaymentMode.CASH}>Cash</option>
                <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer</option>
                <option value={PaymentMode.UPI}>UPI</option>
                <option value={PaymentMode.CHEQUE}>Cheque</option>
                <option value={PaymentMode.CREDIT_CARD}>Credit Card</option>
                <option value={PaymentMode.DEBIT_CARD}>Debit Card</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Date */}
          <div>
            <label htmlFor="pay-date" className="block text-sm font-medium mb-1.5">
              Payment Date <span className="text-destructive">*</span>
            </label>
            <input
              id="pay-date"
              type="date"
              {...register('paymentDate', {
                required: 'Payment date is required',
              })}
              className={cn(
                'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.paymentDate && 'border-destructive',
              )}
            />
            {errors.paymentDate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.paymentDate.message}
              </p>
            )}
          </div>

          {/* Reference */}
          <div>
            <label htmlFor="pay-ref" className="block text-sm font-medium mb-1.5">
              Reference Number
            </label>
            <input
              id="pay-ref"
              type="text"
              {...register('referenceNumber')}
              placeholder="Transaction/Cheque number"
              className={cn(
                'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="pay-notes" className="block text-sm font-medium mb-1.5">
              Notes
            </label>
            <textarea
              id="pay-notes"
              rows={2}
              {...register('notes')}
              placeholder="Optional payment notes..."
              className={cn(
                'w-full rounded-md border bg-field px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>

          {/* Error */}
          {mutationError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {mutationError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={recordPaymentMutation.isPending}
              className={cn(
                'flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {recordPaymentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                'Record Payment'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm',
          highlight && 'text-red-600 font-semibold',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Change a purchase's own details.
 *
 * Its invoice number, date, figures and notes — not what it contains. Units
 * are stock, and stock is corrected on the product itself, where an audit
 * trail is kept of who changed what.
 */
function EditPurchaseDialog({
  purchase,
  onClose,
  onSaved,
}: {
  purchase: { id: string; invoiceNumber: string; invoiceDate: string; totalAmount: number | string; gstAmount: number | string; discountAmount: number | string; notes?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const update = useUpdatePurchaseMutation();
  const [invoiceNumber, setInvoiceNumber] = useState(purchase.invoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(String(purchase.invoiceDate).slice(0, 10));
  const [totalAmount, setTotalAmount] = useState(String(purchase.totalAmount ?? ''));
  const [gstAmount, setGstAmount] = useState(String(purchase.gstAmount ?? ''));
  const [discountAmount, setDiscountAmount] = useState(String(purchase.discountAmount ?? ''));
  const [notes, setNotes] = useState(purchase.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(true, onClose);

  const net = Number(totalAmount || 0) + Number(gstAmount || 0) - Number(discountAmount || 0);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    update.mutate(
      {
        id: purchase.id,
        payload: {
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          totalAmount: Number(totalAmount || 0),
          gstAmount: Number(gstAmount || 0),
          discountAmount: Number(discountAmount || 0),
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: onSaved,
        onError: (err) => {
          const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
          setError(e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Could not save.');
        },
      },
    );
  };

  const field = 'w-full rounded-md border bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={save}
        className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-popover p-5 shadow-lg"
      >
        <h2 className="text-lg font-semibold">Edit purchase</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Invoice number</span>
            <input className={field} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Invoice date</span>
            <input type="date" className={field} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Goods value</span>
            <input type="number" step="0.01" className={field} value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Tax</span>
            <input type="number" step="0.01" className={field} value={gstAmount} onChange={(e) => setGstAmount(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Discount</span>
            <input type="number" step="0.01" className={field} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
          </label>
          <div className="self-end rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Net</p>
            <p className="text-sm font-semibold">{formatINR(net)}</p>
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Notes</span>
          <textarea rows={2} className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending} disabled={!invoiceNumber.trim()}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
