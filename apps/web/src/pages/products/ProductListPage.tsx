import { useMemo, useState, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  X,
  ShoppingCart,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import {
  useProductsQuery,
  useProductsGroupedQuery,
  useCategoryTreeQuery,
  type ProductGroupRow,
} from '../../hooks/useProducts';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import { DateInput } from '../../components/DateInput';
import { StatusBadge } from '../../components/StatusBadge';
import { SerialPickerDialog } from '../../components/SerialPickerDialog';
import {
  formatINR,
  formatDateIN,
  getCurrentFinancialYearRange,
  getLastFinancialYearRange,
} from '@retailerp/shared-utils';
import { ProductStatus } from '@retailerp/shared-types';
import type { Product, ProductCategory } from '@retailerp/shared-types';

const PAGE_SIZE = 20;

export function ProductListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const rootCategoryId = searchParams.get('rootCategoryId') || '';
  const subCategoryId = searchParams.get('subCategoryId') || '';
  const statusFilter = searchParams.get('statusFilter') || '';
  const searchText = searchParams.get('searchText') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const debouncedSearch = useDebounce(searchText, 300);

  const updateFilters = (updates: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      }
      return next;
    }, { replace: true });
  };

  // ------ Categories ------
  const { data: categoryTree } = useCategoryTreeQuery();
  // "All Shops" mode is read-only — we hide write actions (Sell, Transfer)
  // because they would silently use the user's primary shop, which is
  // confusing. The user must pick a specific shop first.
  const currentShopId = useShopStore((s) => s.currentShopId);
  const allShopsMode = isAllShops(currentShopId);
  const rootCategories = categoryTree ?? [];
  const subCategories: ProductCategory[] = useMemo(() => {
    if (!rootCategoryId || !categoryTree) return [];
    const root = categoryTree.find((c) => c.id === rootCategoryId);
    return root?.children ?? [];
  }, [rootCategoryId, categoryTree]);

  // Active filter category: subcategory if selected, else root category
  const activeCategoryId = subCategoryId || rootCategoryId || undefined;

  // Grouped products query — one row per (shop, category, brand, model, status).
  const groupedQuery = useProductsGroupedQuery({
    page,
    pageSize: PAGE_SIZE,
    categoryId: activeCategoryId,
    status: statusFilter || undefined,
    search: debouncedSearch.length >= 3 ? debouncedSearch : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const groups = groupedQuery.data?.data ?? [];
  const pagination = groupedQuery.data?.pagination;

  // Expand state — track which group rows are expanded (lazy-loads units).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Serial-picker dialog state — used by the top-level Sell / Transfer
  // actions on a grouped row (the user must pick which physical unit).
  const [pickerState, setPickerState] = useState<
    | {
        action: 'sell' | 'transfer';
        brand: string;
        modelNumber: string;
        categoryId: string;
        shopId?: string;
      }
    | null
  >(null);

  // ------ Clear filters ------
  const hasFilters =
    rootCategoryId || statusFilter || searchText || dateFrom || dateTo;
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // ------ Handlers ------
  const handleRootCategoryChange = (id: string) => {
    updateFilters({ rootCategoryId: id, subCategoryId: '', page: '1' });
  };

  const handleSubCategoryChange = (id: string) => {
    updateFilters({ subCategoryId: id, page: '1' });
  };

  const handleStatusChange = (status: string) => {
    updateFilters({ statusFilter: status, page: '1' });
  };

  // ------ Group row helpers ------
  const groupKey = (g: ProductGroupRow) =>
    `${g.shopId}|${g.categoryId}|${g.brand}|${g.modelNumber}|${g.status}`;

  const onSerialPick = (productId: string) => {
    if (!pickerState) return;
    const path = pickerState.action === 'sell'
      ? `/sales/new?productId=${productId}`
      : `/transfers/new?productId=${productId}`;
    setPickerState(null);
    navigate(path);
  };

  // ------ Table columns ------
  // Note: this page now renders a custom grouped table inline (one row per
  // brand+model+shop+status) with expandable rows that lazy-load the
  // individual units. We no longer use the generic DataTable here because
  // it doesn't support expandable rows.

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Products</h1>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        {/* Root category */}
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Category
          </label>
          <div className="relative">
            <select
              value={rootCategoryId}
              onChange={(e) => handleRootCategoryChange(e.target.value)}
              className={cn(
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All Categories</option>
              {rootCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Sub-category (only if root selected and has children) */}
        {rootCategoryId && subCategories.length > 0 && (
          <div className="min-w-[180px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Subcategory
            </label>
            <div className="relative">
              <select
                value={subCategoryId}
                onChange={(e) => handleSubCategoryChange(e.target.value)}
                className={cn(
                  'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="">All Subcategories</option>
                {subCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        )}

        {/* Status filter */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Status
          </label>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              className={cn(
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All Statuses</option>
              <option value={ProductStatus.IN_STOCK}>In Stock</option>
              <option value={ProductStatus.SOLD}>Sold</option>
              <option value={ProductStatus.TRANSFERRED}>Transferred</option>
              <option value={ProductStatus.RETURNED}>Returned</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Date of Purchase: From */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Purchased From
          </label>
          <DateInput
            value={dateFrom}
            onChange={(v) => updateFilters({ dateFrom: v, page: '1' })}
            className="w-40"
          />
        </div>

        {/* Date of Purchase: To */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Purchased To
          </label>
          <DateInput
            value={dateTo}
            onChange={(v) => updateFilters({ dateTo: v, page: '1' })}
            className="w-40"
          />
        </div>

        <button
          onClick={() => {
            const { dateFrom: fyStart, dateTo: fyEnd } = getCurrentFinancialYearRange();
            updateFilters({ dateFrom: fyStart, dateTo: fyEnd, page: '1' });
          }}
          className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Current Financial Year
        </button>

        <button
          onClick={() => {
            const { dateFrom: fyStart, dateTo: fyEnd } = getLastFinancialYearRange();
            updateFilters({ dateFrom: fyStart, dateTo: fyEnd, page: '1' });
          }}
          className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Last Financial Year
        </button>

        {/* Search input */}
        <div className="min-w-[240px] flex-1 max-w-sm">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => {
                updateFilters({ searchText: e.target.value, page: '1' });
              }}
              placeholder="Brand, model, serial, or IMEI (min 3 chars)..."
              className={cn(
                'w-full rounded-md border bg-background pl-9 pr-8 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
            {searchText && (
              <button
                onClick={() => {
                  updateFilters({ searchText: '', page: '1' });
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Error state */}
      {groupedQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load products. Please try again.
        </div>
      )}

      {/* Grouped products table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-3"></th>
                {allShopsMode && (
                  <th className="px-3 py-3 text-left font-medium">Shop</th>
                )}
                <th className="px-3 py-3 text-left font-medium">Brand</th>
                <th className="px-3 py-3 text-left font-medium">Model</th>
                <th className="px-3 py-3 text-left font-medium">Category</th>
                <th className="px-3 py-3 text-right font-medium">Quantity</th>
                <th className="px-3 py-3 text-right font-medium">MRP</th>
                <th className="px-3 py-3 text-right font-medium">DP</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedQuery.isLoading ? (
                <tr>
                  <td colSpan={allShopsMode ? 10 : 9} className="px-3 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={allShopsMode ? 10 : 9} className="px-3 py-12 text-center text-muted-foreground">
                    No products found matching your filters.
                  </td>
                </tr>
              ) : (
                groups.map((g) => {
                  const key = groupKey(g);
                  const expanded = expandedKey === key;
                  const inStock = g.status === ProductStatus.IN_STOCK;
                  const categoryName = g.category?.name
                    ?? findCategoryName(categoryTree ?? [], g.categoryId)
                    ?? '-';
                  return (
                    <Fragment key={key}>
                      <tr
                        className="border-t hover:bg-muted/30 cursor-pointer"
                        onClick={() => setExpandedKey(expanded ? null : key)}
                      >
                        <td className="px-2 py-3 text-muted-foreground">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        {allShopsMode && (
                          <td className="px-3 py-3">
                            {g.shop ? (
                              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                                {g.shop.code}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-3 font-medium">{g.brand}</td>
                        <td className="px-3 py-3">{g.modelNumber}</td>
                        <td className="px-3 py-3 text-muted-foreground">{categoryName}</td>
                        <td className="px-3 py-3 text-right">
                          <span className="inline-flex items-center justify-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            {g.quantity}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {priceRange(g.mrpMin, g.mrpMax)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {priceRange(g.purchasePriceMin, g.purchasePriceMax)}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={g.status} />
                        </td>
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {inStock && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() =>
                                  setPickerState({
                                    action: 'sell',
                                    brand: g.brand,
                                    modelNumber: g.modelNumber,
                                    categoryId: g.categoryId,
                                    shopId: g.shopId,
                                  })
                                }
                                disabled={allShopsMode}
                                className={cn(
                                  'rounded-md px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors',
                                  'disabled:opacity-50 disabled:cursor-not-allowed',
                                )}
                                title={allShopsMode ? 'Switch to a single shop to record a sale' : 'Sell from this model'}
                              >
                                <span className="flex items-center gap-1">
                                  <ShoppingCart className="h-3 w-3" />
                                  Sell
                                </span>
                              </button>
                              <button
                                onClick={() =>
                                  setPickerState({
                                    action: 'transfer',
                                    brand: g.brand,
                                    modelNumber: g.modelNumber,
                                    categoryId: g.categoryId,
                                    shopId: g.shopId,
                                  })
                                }
                                disabled={allShopsMode}
                                className={cn(
                                  'rounded-md px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors',
                                  'disabled:opacity-50 disabled:cursor-not-allowed',
                                )}
                                title={allShopsMode ? 'Switch to a single shop to initiate a transfer' : 'Transfer from this model'}
                              >
                                <span className="flex items-center gap-1">
                                  <ArrowRightLeft className="h-3 w-3" />
                                  Transfer
                                </span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20">
                          <td colSpan={allShopsMode ? 10 : 9} className="px-6 py-3">
                            <ExpandedGroupUnits
                              brand={g.brand}
                              modelNumber={g.modelNumber}
                              categoryId={g.categoryId}
                              status={g.status}
                              allShopsMode={allShopsMode}
                              shopIdFilter={g.shopId}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              Showing{' '}
              <span className="font-medium text-foreground">
                {(pagination.page - 1) * pagination.pageSize + 1}
              </span>{' '}
              to{' '}
              <span className="font-medium text-foreground">
                {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)}
              </span>{' '}
              of{' '}
              <span className="font-medium text-foreground">{pagination.totalItems}</span> groups
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateFilters({ page: String(pagination.page - 1) })}
                disabled={pagination.page <= 1}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-2">
                Page {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => updateFilters({ page: String(pagination.page + 1) })}
                disabled={pagination.page >= pagination.totalPages}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Serial picker dialog (Sell / Transfer from a grouped row) */}
      {pickerState && (
        <SerialPickerDialog
          open={true}
          title={pickerState.action === 'sell' ? 'Pick a unit to sell' : 'Pick a unit to transfer'}
          actionLabel={pickerState.action === 'sell' ? 'Sell' : 'Transfer'}
          brand={pickerState.brand}
          modelNumber={pickerState.modelNumber}
          categoryId={pickerState.categoryId}
          shopId={pickerState.shopId}
          onPick={onSerialPick}
          onClose={() => setPickerState(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded-row content: lazy-loads in-stock units for a (brand, model,
// category) tuple and lists per-unit details with row-level Sell/Transfer.
// ---------------------------------------------------------------------------
function ExpandedGroupUnits({
  brand,
  modelNumber,
  categoryId,
  status,
  allShopsMode,
  shopIdFilter,
}: {
  brand: string;
  modelNumber: string;
  categoryId: string;
  status: string;
  allShopsMode: boolean;
  shopIdFilter: string;
}) {
  const navigate = useNavigate();
  const q = useProductsQuery({
    page: 1,
    pageSize: 200,
    categoryId,
    status,
    search: modelNumber,
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading units…
      </div>
    );
  }

  const units = (q.data?.data ?? []).filter(
    (p: Product) =>
      p.brand?.toLowerCase() === brand.toLowerCase()
      && p.modelNumber?.toLowerCase() === modelNumber.toLowerCase()
      && (allShopsMode ? p.shopId === shopIdFilter : true),
  );

  if (units.length === 0) {
    return <p className="py-3 text-muted-foreground">No units to display.</p>;
  }

  const inStock = status === ProductStatus.IN_STOCK;

  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="px-2 py-1.5 text-left">Serial Number</th>
          <th className="px-2 py-1.5 text-left">Distributor</th>
          <th className="px-2 py-1.5 text-left">Date of Purchase</th>
          <th className="px-2 py-1.5 text-right">MRP</th>
          <th className="px-2 py-1.5 text-right">DP</th>
          <th className="px-2 py-1.5 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {units.map((u: Product) => {
          const distributor = (u as any).distributor as { id: string; companyName: string } | null;
          const purchase = (u as any).purchase as { invoiceDate?: string } | null;
          return (
            <tr key={u.id} className="border-t border-border/40">
              <td className="px-2 py-1.5 font-mono">{u.serialNumber || '-'}</td>
              <td className="px-2 py-1.5">{distributor?.companyName ?? '-'}</td>
              <td className="px-2 py-1.5">
                {purchase?.invoiceDate ? formatDateIN(purchase.invoiceDate) : '-'}
              </td>
              <td className="px-2 py-1.5 text-right">{formatINR(u.mrp)}</td>
              <td className="px-2 py-1.5 text-right">{formatINR(u.purchasePrice)}</td>
              <td className="px-2 py-1.5 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => navigate(`/products/${u.id}`)}
                    className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    View
                  </button>
                  {inStock && (
                    <>
                      <button
                        onClick={() => navigate(`/sales/new?productId=${u.id}`)}
                        disabled={allShopsMode}
                        className="rounded-md bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Sell
                      </button>
                      <button
                        onClick={() => navigate(`/transfers/new?productId=${u.id}`)}
                        disabled={allShopsMode}
                        className="rounded-md bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Transfer
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Helper: format min–max as a price range, collapsing to a single value
// when both ends match (common when there's only one unit in the group).
// ---------------------------------------------------------------------------
function priceRange(min: string | null, max: string | null): string {
  if (min == null && max == null) return '-';
  if (min == null || max == null) return formatINR(min ?? max ?? 0);
  if (Number(min) === Number(max)) return formatINR(min);
  return `${formatINR(min)} – ${formatINR(max)}`;
}

// ---------------------------------------------------------------------------
// Helper: recursively find category name in tree
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
