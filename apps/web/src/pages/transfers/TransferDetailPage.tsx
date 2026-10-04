import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useTransferDetailQuery,
  useReceiveTransferMutation,
  useCancelTransferMutation,
} from '../../hooks/useTransfers';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { useAuthStore } from '../../stores/auth-store';
import { useShopStore } from '../../stores/shop-store';
import { UserRole } from '@retailerp/shared-types';

export function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentShopId = useShopStore((s) => s.currentShopId);
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;

  const {
    data: transfer,
    isLoading,
    isError,
  } = useTransferDetailQuery(id);

  // ------ Mutations ------
  const receiveMutation = useReceiveTransferMutation();
  const cancelMutation = useCancelTransferMutation();

  // ------ Confirmation dialogs ------
  const [showReceiveConfirm, setShowReceiveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleReceive = () => {
    if (!id) return;
    receiveMutation.mutate(id, {
      onSuccess: () => {
        setShowReceiveConfirm(false);
      },
    });
  };

  const handleCancel = () => {
    if (!id) return;
    cancelMutation.mutate(id, {
      onSuccess: () => {
        setShowCancelConfirm(false);
      },
    });
  };

  // Can this user receive? Only admin whose current shop is the destination
  const canReceive =
    isAdmin &&
    transfer?.status === 'initiated' &&
    transfer?.toShopId === currentShopId;

  // Can this user cancel? Only admin when status is initiated
  const canCancel = isAdmin && transfer?.status === 'initiated';

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !transfer) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Transfer Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The transfer you are looking for does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Transfers
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
              Transfer #{transfer.id.slice(0, 8).toUpperCase()}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={transfer.status} />
              <span className="text-sm text-muted-foreground">
                {formatDateIN(transfer.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {canReceive && (
            <button
              onClick={() => setShowReceiveConfirm(true)}
              className={cn(
                'flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary-hover transition-colors',
              )}
            >
              <CheckCircle className="h-4 w-4" />
              Receive
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className={cn(
                'flex items-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white',
                'hover:bg-red-700 transition-colors',
              )}
            >
              <XCircle className="h-4 w-4" />
              Cancel Transfer
            </button>
          )}
        </div>
      </div>

      {/* Transfer info card */}
      <div className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-lg font-medium mb-4">Transfer Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoRow
            label="Status"
            value={transfer.status.replace(/_/g, ' ')}
            badge={<StatusBadge status={transfer.status} />}
          />
          <InfoRow
            label="Product"
            value={
              transfer.product
                ? `${transfer.product.brand} ${transfer.product.modelNumber}`
                : '-'
            }
          />
          <InfoRow
            label="Serial Number"
            value={transfer.product?.serialNumber ?? '-'}
            mono
          />
          <InfoRow
            label="From Shop"
            value={
              transfer.fromShop
                ? `${transfer.fromShop.name} (${transfer.fromShop.code})`
                : '-'
            }
          />
          <InfoRow
            label="To Shop"
            value={
              transfer.toShop
                ? `${transfer.toShop.name} (${transfer.toShop.code})`
                : '-'
            }
          />
          <InfoRow label="Date" value={formatDateIN(transfer.createdAt)} />
          <InfoRow
            label="Transfer Price"
            value={
              transfer.transferPrice != null
                ? formatINR(transfer.transferPrice)
                : '-'
            }
          />
          <InfoRow
            label="GST Amount"
            value={
              transfer.gstAmount != null
                ? formatINR(transfer.gstAmount)
                : '-'
            }
          />
          <InfoRow
            label="Invoice Number"
            value={transfer.invoiceNumber ?? '-'}
          />
          {transfer.notes && (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-sm font-medium text-muted-foreground">Notes</p>
              <p className="mt-0.5 text-sm">{transfer.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Product info card */}
      {transfer.product && (
        <div className="rounded-lg border bg-card p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">Product Information</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoRow label="Brand" value={transfer.product.brand} />
            <InfoRow label="Model" value={transfer.product.modelNumber} />
            <InfoRow
              label="Serial Number"
              value={transfer.product.serialNumber ?? '-'}
              mono
            />
            <InfoRow
              label="Current Status"
              value={transfer.product.status}
              badge={<StatusBadge status={transfer.product.status} />}
            />
            <InfoRow label="MRP" value={formatINR(transfer.product.mrp)} />
            <InfoRow
              label="Selling Price"
              value={formatINR(transfer.product.sellingPrice)}
            />
            <InfoRow
              label="Purchase Price"
              value={formatINR(transfer.product.purchasePrice)}
            />
          </div>
        </div>
      )}

      {/* Timeline / Activity */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-4">Activity</h2>
        <div className="space-y-4">
          {/* Initiated event */}
          <TimelineEvent
            label="Initiated"
            user={transfer.initiatedByUser?.fullName ?? '-'}
            date={transfer.initiatedAt ?? transfer.createdAt}
            color="blue"
          />

          {/* Received event */}
          {transfer.status === 'received' && transfer.receivedAt && (
            <TimelineEvent
              label="Received"
              user={transfer.receivedByUser?.fullName ?? '-'}
              date={transfer.receivedAt}
              color="green"
            />
          )}

          {/* Cancelled event */}
          {transfer.status === 'cancelled' && transfer.cancelledAt && (
            <TimelineEvent
              label="Cancelled"
              user="-"
              date={transfer.cancelledAt}
              color="red"
            />
          )}
        </div>
      </div>

      {/* ============================== RECEIVE CONFIRM DIALOG ============================== */}
      {showReceiveConfirm && (
        <ConfirmDialog
          title="Confirm Receipt"
          description="Are you sure you want to mark this transfer as received? This will add the product to your shop's inventory."
          confirmLabel="Confirm Receive"
          confirmColor="green"
          isPending={receiveMutation.isPending}
          pendingLabel="Receiving..."
          error={receiveMutation.error}
          onConfirm={handleReceive}
          onCancel={() => setShowReceiveConfirm(false)}
          icon={<CheckCircle className="h-4 w-4" />}
        />
      )}

      {/* ============================== CANCEL CONFIRM DIALOG ============================== */}
      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel Transfer"
          description="Are you sure you want to cancel this transfer? The product will remain in the original shop's inventory."
          confirmLabel="Cancel Transfer"
          confirmColor="red"
          isPending={cancelMutation.isPending}
          pendingLabel="Cancelling..."
          error={cancelMutation.error}
          onConfirm={handleCancel}
          onCancel={() => setShowCancelConfirm(false)}
          icon={<XCircle className="h-4 w-4" />}
        />
      )}
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
  mono = false,
  badge,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        {badge || (
          <span
            className={cn(
              'text-sm',
              highlight && 'text-red-600 dark:text-red-400 font-semibold',
              mono && 'font-mono text-xs',
            )}
          >
            {value}
          </span>
        )}
      </dd>
    </div>
  );
}

function TimelineEvent({
  label,
  user,
  date,
  color,
}: {
  label: string;
  user: string;
  date: string;
  color: 'blue' | 'green' | 'red';
}) {
  const dotColor = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
  }[color];

  return (
    <div className="flex items-start gap-3">
      <div className={cn('mt-1.5 h-2.5 w-2.5 rounded-full shrink-0', dotColor)} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          by {user} &middot; {formatDateIN(date)}
        </p>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmColor,
  isPending,
  pendingLabel,
  error,
  onConfirm,
  onCancel,
  icon,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmColor: 'green' | 'red';
  isPending: boolean;
  pendingLabel: string;
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
  icon: React.ReactNode;
}) {
  const btnClass =
    confirmColor === 'green'
      ? 'bg-primary hover:bg-primary-hover'
      : 'bg-red-600 hover:bg-red-700';

  const errorMessage = error
    ? (error as any)?.response?.data?.error ??
      'Something went wrong. Please try again.'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-6 shadow-xl mx-4">
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4">{description}</p>

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              'flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-white transition-colors',
              btnClass,
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {pendingLabel}
              </>
            ) : (
              <>
                {icon}
                {confirmLabel}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
