import { useParams, useNavigate } from 'react-router-dom';
import { useCanCheck } from '../../hooks/usePermission';
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
  CheckCircle2,
  Globe,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useProductDetailQuery,
  useProductHistoryQuery,
  useCategoryTreeQuery,
  useEnrichProductMutation,
} from '../../hooks/useProducts';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { ProductStatus } from '@retailerp/shared-types';
import type {
  ProductCategory,
  ProductAuditTrailEntry,
  ProductEnrichResult,
} from '@retailerp/shared-types';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: product, isLoading, isError } = useProductDetailQuery(id);
  const { data: history, isLoading: isHistoryLoading } = useProductHistoryQuery(id);
  const { data: categoryTree } = useCategoryTreeQuery();
  const enrich = useEnrichProductMutation();

  const can = useCanCheck();
  const canEdit = can('products.edit');
  const canSell = ['sales.create_full_payment', 'sales.create_partial_with_promise', 'sales.create_self_finance', 'sales.create_company_finance'].some(can);
  const canTransfer = can('transfers.initiate');

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

  // Determine dynamic attribute entries. The web lookup's own bookkeeping
  // (when it last ran, the MRP it suggested) is kept out of the grid — both
  // are shown properly in the "Details from the web" card instead.
  const dynamicEntries = product.dynamicAttributes
    ? Object.entries(product.dynamicAttributes).filter(([key]) => !WEB_LOOKUP_KEYS.has(key))
    : [];
  const attributes = (product.dynamicAttributes ?? {}) as Record<string, unknown>;
  const mrpSuggestion = Number(attributes.mrpSuggestion) || null;
  const priceNotSet = attributes.priceNotSet === true;

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

        {(canEdit || canSell || canTransfer) && (
          <div className="flex items-center gap-2">
            {canEdit && (
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
            )}
            {product.status === ProductStatus.IN_STOCK && (
              <>
                {canSell && (
                <button
                  onClick={() =>
                    navigate(`/sales/new?productId=${product.id}`)
                  }
                  className={cn(
                    'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                    'hover:bg-primary-hover transition-colors',
                  )}
                >
                  <ShoppingCart className="h-4 w-4" />
                  Sell Item
                </button>
                )}
                {canTransfer && (
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
                )}
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
              {can('products.view_dp') && (
                <InfoRow
                  label="DP (Dealer Price)"
                  value={formatINR(product.purchasePrice)}
                />
              )}
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

          {/* Details fetched from the web */}
          {(canEdit || mrpSuggestion !== null) && (
            <WebDetailsCard
              canEdit={canEdit}
              priceNotSet={priceNotSet}
              savedMrpSuggestion={mrpSuggestion}
              isPending={enrich.isPending}
              error={enrich.isError ? apiError(enrich.error) : null}
              result={enrich.data ?? null}
              onFetch={() => enrich.mutate(product.id)}
              onEditPrice={() => navigate(`/products/${product.id}/edit`)}
            />
          )}

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

/**
 * Filling in what a spreadsheet could not say.
 *
 * A unit imported from a purchase register has no specifications at all and
 * sits at cost, because the register carries only a cost. This card asks the
 * web for the rest. Anything already entered is left exactly as it is, and
 * an MRP that comes back is a suggestion only — nobody's selling price is
 * changed behind their back.
 */
function WebDetailsCard({
  canEdit,
  priceNotSet,
  savedMrpSuggestion,
  isPending,
  error,
  result,
  onFetch,
  onEditPrice,
}: {
  canEdit: boolean;
  priceNotSet: boolean;
  savedMrpSuggestion: number | null;
  isPending: boolean;
  error: string | null;
  result: ProductEnrichResult | null;
  onFetch: () => void;
  onEditPrice: () => void;
}) {
  const mrpSuggestion = result?.mrpSuggestion ?? savedMrpSuggestion;

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Details from the web</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {priceNotSet
              ? 'This unit came from a spreadsheet, which carried only its cost. Look the rest up by model number.'
              : 'Fill in any specification that is still empty by looking the model up online.'}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={onFetch}
            disabled={isPending}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
              'hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
            {isPending ? 'Searching...' : result ? 'Search again' : 'Fetch details'}
          </button>
        )}
      </div>

      {isPending && (
        <p className="mt-4 text-sm text-muted-foreground">
          Searching for this model's specifications. This usually takes a few seconds.
        </p>
      )}

      {error && !isPending && (
        <p className="mt-4 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {result && !isPending && (
        <div className="mt-4 space-y-3 text-sm">
          {result.filled.length > 0 && (
            <div>
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                Filled in {result.filled.length} detail{result.filled.length === 1 ? '' : 's'}
              </p>
              <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {result.filled.map((item) => (
                  <div key={item.attributeName}>
                    <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
                    <dd className="mt-0.5 text-sm">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {result.message && (
            <p className={cn('text-muted-foreground', !result.aiEnabled && 'text-warning')}>
              {result.message}
            </p>
          )}

          {result.kept.length > 0 && (
            <p className="text-muted-foreground">
              {result.kept.length} detail{result.kept.length === 1 ? '' : 's'} were already
              filled in and left untouched: {result.kept.map((item) => item.label).join(', ')}.
            </p>
          )}

          {result.unresolved.length > 0 && (
            <p className="text-muted-foreground">
              Still empty — the search could not establish{' '}
              {result.unresolved.map((item) => item.label).join(', ')}.
            </p>
          )}
        </div>
      )}

      {mrpSuggestion !== null && (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning-muted px-4 py-3 text-sm">
          <p className="font-medium">Suggested MRP {formatINR(mrpSuggestion)}</p>
          <p className="mt-0.5 text-muted-foreground">
            Found on the web and kept as a suggestion only. Retail listings disagree about MRPs
            often enough that it is worth checking against the box before you price this unit.
          </p>
          {canEdit && (
            <button onClick={onEditPrice} className="mt-2 text-sm font-medium text-primary hover:underline">
              Set the price
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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

/** The web lookup's own bookkeeping, shown in its card rather than the grid. */
const WEB_LOOKUP_KEYS = new Set(['mrpSuggestion', 'specsLookedUpAt']);

function apiError(error: unknown): string {
  const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Something went wrong.';
}

/** Convert snake_case attribute name to human-readable label */
function formatAttributeLabel(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
