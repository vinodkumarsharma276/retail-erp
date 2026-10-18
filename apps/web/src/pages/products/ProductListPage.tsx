import { useMemo, useState, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCanCheck } from '../../hooks/usePermission';
import {
  
  
  ShoppingCart,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Loader2 } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import {
  useProductsQuery,
  useProductsGroupedQuery,
  useCategoryTreeQuery,
  type ProductGroupRow,
} from '../../hooks/useProducts';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import { DateInput } from '../../components/DateInput';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar, FilterField } from '../../components/FilterBar';
import { Select } from '../../components/ui/select';
import { Tabs } from '../../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIconTrigger,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import { StatusBadge } from '../../components/StatusBadge';
import { IncompleteProductBadge } from '../../components/IncompleteProductBadge';
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
  const can = useCanCheck();
  const canSell = ['sales.create_full_payment', 'sales.create_partial_with_promise', 'sales.create_self_finance', 'sales.create_company_finance'].some(can);
  const canTransfer = can('transfers.initiate');
  const canSeeCost = can('products.view_dp');
  const columns = (allShopsModeFlag: boolean) => (allShopsModeFlag ? 10 : 9) - (canSeeCost ? 0 : 1);
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

  // Financial-year preset backing the segmented control. Unlike Sales, this
  // page has no default range, so an empty range is also "custom".
  const currentFyRange = getCurrentFinancialYearRange();
  const lastFyRange = getLastFinancialYearRange();
  const fyPreset: 'current' | 'last' | 'custom' =
    dateFrom === currentFyRange.dateFrom && dateTo === currentFyRange.dateTo
      ? 'current'
      : dateFrom === lastFyRange.dateFrom && dateTo === lastFyRange.dateTo
        ? 'last'
        : 'custom';

  const activeFilterCount = [
    !!rootCategoryId || !!subCategoryId,
    !!statusFilter,
    !!dateFrom || !!dateTo,
  ].filter(Boolean).length;

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
      <PageHeader
        title="Products"
        description="Stock on hand across every category, with purchase and margin detail."
      />

      <FilterBar
        search={searchText}
        onSearchChange={(value) => updateFilters({ searchText: value, page: '1' })}
        searchPlaceholder="Brand, model, serial or IMEI (min 3 chars)…"
        activeCount={activeFilterCount}
        onClear={hasFilters ? clearFilters : undefined}
        trailing={
          <Tabs
            aria-label="Purchase date preset"
            value={fyPreset}
            onChange={(value) => {
              if (value === 'custom') return;
              const range =
                value === 'current'
                  ? getCurrentFinancialYearRange()
                  : getLastFinancialYearRange();
              updateFilters({ dateFrom: range.dateFrom, dateTo: range.dateTo, page: '1' });
            }}
            items={[
              { value: 'current', label: 'This FY' },
              { value: 'last', label: 'Last FY' },
              ...(fyPreset === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
            ]}
          />
        }
        advanced={
          <>
            <FilterField label="Purchased from">
              <DateInput
                value={dateFrom}
                onChange={(v) => updateFilters({ dateFrom: v, page: '1' })}
              />
            </FilterField>
            <FilterField label="Purchased to">
              <DateInput
                value={dateTo}
                onChange={(v) => updateFilters({ dateTo: v, page: '1' })}
              />
            </FilterField>
          </>
        }
      >
        <FilterField label="Category">
          <Select
            value={rootCategoryId}
            onChange={(e) => handleRootCategoryChange(e.target.value)}
          >
            <option value="">All categories</option>
            {rootCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </Select>
        </FilterField>

        {rootCategoryId && subCategories.length > 0 && (
          <FilterField label="Subcategory">
            <Select
              value={subCategoryId}
              onChange={(e) => handleSubCategoryChange(e.target.value)}
            >
              <option value="">All subcategories</option>
              {subCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </FilterField>
        )}

        <FilterField label="Status" width="sm">
          <Select value={statusFilter} onChange={(e) => handleStatusChange(e.target.value)}>
            <option value="">All</option>
            <option value={ProductStatus.IN_STOCK}>In Stock</option>
            <option value={ProductStatus.SOLD}>Sold</option>
            <option value={ProductStatus.TRANSFERRED}>Transferred</option>
            <option value={ProductStatus.RETURNED}>Returned</option>
          </Select>
        </FilterField>
      </FilterBar>

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
                {canSeeCost && <th className="px-3 py-3 text-right font-medium">DP</th>}
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedQuery.isLoading ? (
                <tr>
                  <td colSpan={columns(allShopsMode)} className="px-3 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={columns(allShopsMode)} className="px-3 py-12 text-center text-muted-foreground">
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
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            {g.modelNumber}
                            <IncompleteProductBadge counts={g.needsAttention} quantity={g.quantity} />
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{categoryName}</td>
                        <td className="px-3 py-3 text-right">
                          <span className="inline-flex items-center justify-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            {g.quantity}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {priceRange(g.mrpMin, g.mrpMax)}
                        </td>
                        {canSeeCost && (
                          <td className="px-3 py-3 text-right">
                            {priceRange(g.purchasePriceMin, g.purchasePriceMax)}
                          </td>
                        )}
                        <td className="px-3 py-3">
                          <StatusBadge status={g.status} />
                        </td>
                        {/*
                         * Sell + Transfer used to render as two filled colour
                         * chips on every single row, so a full page of stock
                         * was a wall of green and blue. They now live behind a
                         * single overflow menu — the actions are identical,
                         * but the data is what you see first.
                         */}
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {inStock && (canSell || canTransfer) && (
                            <DropdownMenu>
                              <DropdownMenuIconTrigger label="Product actions" />
                              <DropdownMenuContent>
                                {canSell && (
                                <DropdownMenuItem
                                  icon={<ShoppingCart className="h-3.5 w-3.5" />}
                                  disabled={allShopsMode}
                                  title={
                                    allShopsMode
                                      ? 'Switch to a single shop to record a sale'
                                      : undefined
                                  }
                                  onClick={() =>
                                    setPickerState({
                                      action: 'sell',
                                      brand: g.brand,
                                      modelNumber: g.modelNumber,
                                      categoryId: g.categoryId,
                                      shopId: g.shopId,
                                    })
                                  }
                                >
                                  Sell this model
                                </DropdownMenuItem>
                                )}
                                {canTransfer && (
                                <DropdownMenuItem
                                  icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
                                  disabled={allShopsMode}
                                  title={
                                    allShopsMode
                                      ? 'Switch to a single shop to initiate a transfer'
                                      : undefined
                                  }
                                  onClick={() =>
                                    setPickerState({
                                      action: 'transfer',
                                      brand: g.brand,
                                      modelNumber: g.modelNumber,
                                      categoryId: g.categoryId,
                                      shopId: g.shopId,
                                    })
                                  }
                                >
                                  Transfer to shop
                                </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20">
                          <td colSpan={columns(allShopsMode)} className="px-6 py-3">
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
  const can = useCanCheck();
  const canSell = ['sales.create_full_payment', 'sales.create_partial_with_promise', 'sales.create_self_finance', 'sales.create_company_finance'].some(can);
  const canTransfer = can('transfers.initiate');
  const canSeeCost = can('products.view_dp');
  const canSeeSupplier = can('products.view_distributor');
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
          {canSeeSupplier && <th className="px-2 py-1.5 text-left">Distributor</th>}
          <th className="px-2 py-1.5 text-left">Date of Purchase</th>
          <th className="px-2 py-1.5 text-right">MRP</th>
          {canSeeCost && <th className="px-2 py-1.5 text-right">DP</th>}
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
              {canSeeSupplier && <td className="px-2 py-1.5">{distributor?.companyName ?? '-'}</td>}
              <td className="px-2 py-1.5">
                {purchase?.invoiceDate ? formatDateIN(purchase.invoiceDate) : '-'}
              </td>
              <td className="px-2 py-1.5 text-right">{formatINR(u.mrp)}</td>
              {canSeeCost && <td className="px-2 py-1.5 text-right">{formatINR(u.purchasePrice)}</td>}
              <td className="px-2 py-1.5 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  {can('products.detail') && (
                  <button
                    onClick={() => navigate(`/products/${u.id}`)}
                    className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    View
                  </button>
                  )}
                  {inStock && (
                    <>
                      {canSell && (
                      <button
                        onClick={() => navigate(`/sales/new?productId=${u.id}`)}
                        disabled={allShopsMode}
                        className="rounded-md bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Sell
                      </button>
                      )}
                      {canTransfer && (
                      <button
                        onClick={() => navigate(`/transfers/new?productId=${u.id}`)}
                        disabled={allShopsMode}
                        className="rounded-md bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Transfer
                      </button>
                      )}
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
  if (min == null || max == null) return formatINR(Number(min ?? max ?? 0));
  if (Number(min) === Number(max)) return formatINR(Number(min));
  return `${formatINR(Number(min))} – ${formatINR(Number(max))}`;
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
