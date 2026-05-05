import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Pencil,
  ShoppingCart,
  ArrowRightLeft,
  Package,
  Truck,
  ReceiptText,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useProductDetailQuery,
  useProductHistoryQuery,
  useCategoryTreeQuery,
} from '../../hooks/useProducts';
import { useAuthStore } from '../../stores/auth-store';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { ProductStatus, UserRole } from '@retailerp/shared-types';
import type { ProductCategory, ProductAuditTrailEntry } from '@retailerp/shared-types';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const { data: product, isLoading, isError } = useProductDetailQuery(id);
  const { data: history, isLoading: isHistoryLoading } = useProductHistoryQuery(id);
  const { data: categoryTree } = useCategoryTreeQuery();

  const canEdit =
    user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN || user?.role === UserRole.ACCOUNTANT;

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (isError || !product) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-medium mb-2">Product Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The product you are looking for does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Products
        </button>
      </div>
    );
  }

  const categoryName = categoryTree
    ? findCategoryName(categoryTree, product.categoryId)
    : null;
  const categoryHsnCode = categoryTree
    ? findCategoryHsnCode(categoryTree, product.categoryId)
    : null;

  // Determine dynamic attribute entries
  const dynamicEntries = product.dynamicAttributes
    ? Object.entries(product.dynamicAttributes)
    : [];

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
            <h1 className="text-2xl font-semibold">
              {product.brand} {product.modelNumber}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={product.status} />
              {categoryName && (
                <span className="text-sm text-muted-foreground">
                  {categoryName}
                </span>
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/products/${product.id}/edit`)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
                'hover:bg-muted transition-colors',
              )}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            {product.status === ProductStatus.IN_STOCK && (
              <>
                <button
                  onClick={() =>
                    navigate(`/sales/new?productId=${product.id}`)
                  }
                  className={cn(
                    'flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white',
                    'hover:bg-green-700 transition-colors',
                  )}
                >
                  <ShoppingCart className="h-4 w-4" />
                  Sell Item
                </button>
                <button
                  onClick={() =>
                    navigate(`/transfers/new?productId=${product.id}`)
                  }
                  className={cn(
                    'flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white',
                    'hover:bg-blue-700 transition-colors',
                  )}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Transfer
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: Product info (60%) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Main info card */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Product Information</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoRow label="Brand" value={product.brand} />
              <InfoRow label="Model Number" value={product.modelNumber} />
              <InfoRow label="Serial Number" value={product.serialNumber ?? '-'} />
              <InfoRow label="Category" value={categoryName ?? '-'} />
              <InfoRow label="HSN Code" value={categoryHsnCode ?? '-'} />
              <InfoRow label="MRP" value={formatINR(product.mrp)} />
              <InfoRow
                label="DP (Dealer Price)"
                value={formatINR(product.purchasePrice)}
              />
              <InfoRow label="Color" value={product.color ?? '-'} />
              <InfoRow
                label="Weight"
                value={
                  product.weightKg ? `${product.weightKg} kg` : '-'
                }
              />
              <InfoRow
                label="Warranty"
                value={
                  product.warrantyMonths
                    ? `${product.warrantyMonths} months`
                    : '-'
                }
              />
              {product.warrantyExpiry && (
                <InfoRow
                  label="Warranty Expiry"
                  value={formatDateIN(product.warrantyExpiry)}
                />
              )}
              <InfoRow label="Barcode" value={product.barcode ?? '-'} />
              <InfoRow
                label="Invoice Date"
                value={
                  product.purchase?.invoiceDate
                    ? formatDateIN(product.purchase.invoiceDate)
                    : '-'
                }
              />
              <InfoRow
                label="Created"
                value={formatDateIN(product.createdAt)}
              />
              <InfoRow
                label="Last Updated"
                value={formatDateIN(product.updatedAt)}
              />
            </dl>

            {product.notes && (
              <div className="mt-4 pt-4 border-t">
                <dt className="text-sm font-medium text-muted-foreground mb-1">
                  Notes
                </dt>
                <dd className="text-sm whitespace-pre-wrap">{product.notes}</dd>
              </div>
            )}
          </div>

          {/* Dynamic attributes */}
          {dynamicEntries.length > 0 && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-medium mb-4">
                Category-Specific Details
              </h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {dynamicEntries.map(([key, value]) => {
                  // Arrays of strings (e.g. IMEI numbers) get rendered as
                  // a vertical list of monospace chips so each entry is
                  // easy to read and copy.
                  if (Array.isArray(value)) {
                    return (
                      <div key={key}>
                        <dt className="text-sm font-medium text-muted-foreground">
                          {formatAttributeLabel(key)}
                        </dt>
                        <dd className="mt-1 flex flex-col gap-1">
                          {value.length === 0 ? (
                            <span className="text-sm">-</span>
                          ) : (
                            value.map((entry, idx) => (
                              <span
                                key={`${key}-${idx}`}
                                className="inline-flex w-fit items-center rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs"
                              >
                                {String(entry ?? '')}
                              </span>
                            ))
                          )}
                        </dd>
                      </div>
                    );
                  }
                  return (
                    <InfoRow
                      key={key}
                      label={formatAttributeLabel(key)}
                      value={
                        typeof value === 'boolean'
                          ? value
                            ? 'Yes'
                            : 'No'
                          : String(value ?? '-')
                      }
                    />
                  );
                })}
              </dl>
            </div>
          )}
        </div>

        {/* Right: Audit Trail (40%) */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-medium mb-4">Audit Trail</h2>

            {isHistoryLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : !history || history.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No history recorded yet.
              </p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />

                <div className="space-y-6">
                  {history.map((entry, idx) => (
                    <TimelineNode key={entry.id} entry={entry} isFirst={idx === 0} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

const eventConfig: Record<
  string,
  { icon: typeof Package; color: string; bgColor: string; label: string }
> = {
  purchased: {
    icon: Package,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'Purchased',
  },
  transferred_out: {
    icon: Truck,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'Transferred Out',
  },
  transferred_in: {
    icon: Truck,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'Transferred In',
  },
  sold: {
    icon: ReceiptText,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Sold',
  },
  returned: {
    icon: RotateCcw,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    label: 'Returned',
  },
};

function TimelineNode({
  entry,
  isFirst,
}: {
  entry: ProductAuditTrailEntry;
  isFirst: boolean;
}) {
  const config = eventConfig[entry.eventType] ?? {
    icon: Package,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    label: entry.eventType,
  };
  const Icon = config.icon;

  return (
    <div className="relative flex gap-4 pl-1">
      {/* Icon dot */}
      <div
        className={cn(
          'z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          config.bgColor,
          config.color,
          isFirst && 'ring-2 ring-offset-2 ring-primary/30',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 pt-0.5">
        <p className={cn('text-sm font-medium', config.color)}>
          {config.label}
        </p>
        {entry.notes && (
          <p className="text-sm text-muted-foreground mt-0.5">{entry.notes}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {formatDateIN(entry.createdAt)}
          {entry.performer && (
            <span>
              {' '}&middot; by {entry.performer.fullName || entry.performer.username}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findCategoryName(
  nodes: ProductCategory[],
  targetId: string,
): string | null {
  for (const node of nodes) {
    if (node.id === targetId) return node.name;
    if (node.children?.length) {
      const found = findCategoryName(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

function findCategoryHsnCode(
  nodes: ProductCategory[],
  targetId: string,
): string | null {
  for (const node of nodes) {
    if (node.id === targetId) return node.hsnCode ?? null;
    if (node.children?.length) {
      const found = findCategoryHsnCode(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

/** Convert snake_case attribute name to human-readable label */
function formatAttributeLabel(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
