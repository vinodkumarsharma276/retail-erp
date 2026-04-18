import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  X,
  Pencil,
  ShoppingCart,
  ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useProductsQuery, useCategoryTreeQuery } from '../../hooks/useProducts';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR } from '@retailerp/shared-utils';
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

  // Categories
  const { data: categoryTree } = useCategoryTreeQuery();
  const rootCategories = categoryTree ?? [];
  const subCategories: ProductCategory[] = useMemo(() => {
    if (!rootCategoryId || !categoryTree) return [];
    const root = categoryTree.find((c) => c.id === rootCategoryId);
    return root?.children ?? [];
  }, [rootCategoryId, categoryTree]);

  // Active filter category: subcategory if selected, else root category
  const activeCategoryId = subCategoryId || rootCategoryId || undefined;

  // Products query
  const productsQuery = useProductsQuery({
    page,
    pageSize: PAGE_SIZE,
    categoryId: activeCategoryId,
    status: statusFilter || undefined,
    search: debouncedSearch.length >= 3 ? debouncedSearch : undefined,
  });

  const products = productsQuery.data?.data ?? [];
  const pagination = productsQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = rootCategoryId || statusFilter || searchText;
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

  // ------ Table columns ------
  const columns: Column<Product>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) =>
        pagination
          ? (pagination.page - 1) * pagination.pageSize + idx + 1
          : idx + 1,
      className: 'w-16',
    },
    {
      key: 'brand',
      header: 'Brand',
      render: (row) => <span className="font-medium">{row.brand}</span>,
    },
    {
      key: 'model',
      header: 'Model',
      render: (row) => row.modelNumber,
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => {
        // Find category name from tree
        const name = findCategoryName(categoryTree ?? [], row.categoryId);
        return name ?? '-';
      },
    },
    {
      key: 'distributor',
      header: 'Distributor',
      render: (row) => {
        const distributor = (row as any).distributor as { id: string; companyName: string } | null;
        return distributor?.companyName ?? '-';
      },
    },
    {
      key: 'serial',
      header: 'Serial Number',
      render: (row) => (
        <span className="font-mono text-xs">{row.serialNumber ?? '-'}</span>
      ),
    },
    {
      key: 'mrp',
      header: 'MRP',
      align: 'right',
      render: (row) => formatINR(row.mrp),
    },
    {
      key: 'purchasePrice',
      header: 'DP (Dealer Price)',
      align: 'right',
      render: (row) => formatINR(row.purchasePrice),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => navigate(`/products/${row.id}/edit`)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Edit product"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {row.status === ProductStatus.IN_STOCK && (
            <button
              onClick={() => navigate(`/sales/new?productId=${row.id}`)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
              title="Sell this product"
            >
              <span className="flex items-center gap-1">
                <ShoppingCart className="h-3 w-3" />
                Sell
              </span>
            </button>
          )}
        </div>
      ),
    },
  ];

  // ------ Pagination state for DataTable ------
  const paginationState: PaginationState | undefined = pagination
    ? {
        page: pagination.page,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        pageSize: pagination.pageSize,
      }
    : undefined;

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
              placeholder="Brand, model, or serial (min 3 chars)..."
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
      {productsQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load products. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<Product>
        columns={columns}
        data={products}
        isLoading={productsQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No products found matching your filters."
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/products/${row.id}`)}
      />
    </div>
  );
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
