import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, X, Pencil } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useCustomersQuery } from '../../hooks/useCustomers';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { formatDateIN, formatPhone } from '@retailerp/shared-utils';
import type { Customer } from '@retailerp/shared-types';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import { usePermission, useCanCheck } from '../../hooks/usePermission';

const PAGE_SIZE = 20;

const ZONE_OPTIONS = ['East', 'West', 'North', 'South', 'Delhi', 'Ghaziabad', 'Noida'] as const;

export function CustomerListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canSeeZone = usePermission('view.customer.address.zone');
  const can = useCanCheck();

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const searchText = searchParams.get('search') || '';
  const zoneFilter = searchParams.get('zone') || '';
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

  // Customers query
  const customersQuery = useCustomersQuery({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
    zone: zoneFilter || undefined,
  });

  const customers = customersQuery.data?.data ?? [];
  const pagination = customersQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = !!searchText || !!zoneFilter;
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // ------ Table columns ------
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));

  const columns: Column<Customer>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) =>
        pagination
          ? (pagination.page - 1) * pagination.pageSize + idx + 1
          : idx + 1,
      className: 'w-16',
    },
    // Shop column — only in "All Shops" mode so the user can tell which
    // GST entity each customer belongs to.
    ...(allShopsMode
      ? ([
          {
            key: 'shop' as keyof Customer,
            header: 'Shop',
            sortable: true,
            sortAccessor: (row: Customer) => row.shop?.code ?? '',
            render: (row: Customer) =>
              row.shop ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                  {row.shop.code}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
            className: 'w-20',
          },
        ] as Column<Customer>[])
      : []),
    {
      key: 'customerCode',
      header: 'Customer Code',
      render: (row) => (
        <button
          onClick={() => navigate(`/customers/${row.id}`)}
          className="font-mono text-xs font-medium text-primary hover:underline text-left"
        >
          {row.customerCode}
        </button>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <button
          onClick={() => navigate(`/customers/${row.id}`)}
          className="font-medium text-primary hover:underline text-left"
        >
          {row.name}
        </button>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => (
        <div>
          <p>{formatPhone(row.phone)}</p>
          {row.altPhone && (
            <p className="text-xs text-muted-foreground">{formatPhone(row.altPhone)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'city',
      header: 'City',
      render: (row) => row.city || '-',
    },
    ...(canSeeZone
      ? ([
          {
            key: 'zone' as keyof Customer,
            header: 'Zone',
            sortable: true,
            sortAccessor: (row: Customer) => row.zone ?? '',
            render: (row: Customer) =>
              row.zone ? (
                <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                  {row.zone}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
            className: 'w-24',
          },
        ] as Column<Customer>[])
      : []),
    {
      key: 'guarantor',
      header: 'Guarantor',
      render: (row) =>
        row.isGuarantor ? (
          <span className="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-400">
            Is Guarantor
          </span>
        ) : row.guarantorId ? (
          <span className="text-sm text-muted-foreground">Linked</span>
        ) : (
          '-'
        ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDateIN(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      // The only way to act on a row; hiding it would strand the row.
      alwaysVisible: true,
      exportable: false,
      resizable: false,
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-2">
          {can('customers.edit') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/customers/${row.id}/edit`);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Edit customer"
          >
            <Pencil className="h-4 w-4" />
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
      <PageHeader
        title="Customers"
        description="Everyone you've sold to, including guarantors on installment sales."
        actions={
          !can('customers.create') ? null : allShopsMode ? (
            <Button disabled title="Switch to a single shop to add a customer" icon={<Plus className="h-3.5 w-3.5" />}>
              Add customer
            </Button>
          ) : (
            <Link to="/customers/new">
              <Button icon={<Plus className="h-3.5 w-3.5" />}>Add customer</Button>
            </Link>
          )
        }
      />

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        {/* Search input */}
        <div className="min-w-[320px] flex-1 max-w-md">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => {
                updateFilters({ search: e.target.value, page: '1' });
              }}
              placeholder="Name, phone, or customer code (min 2 chars)..."
              className={cn(
                'w-full rounded-md border bg-field pl-9 pr-8 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
            {searchText && (
              <button
                onClick={() => {
                  updateFilters({ search: '', page: '1' });
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Zone filter — only when permitted to see zones */}
        {canSeeZone && (
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Zone
            </label>
            <select
              value={zoneFilter}
              onChange={(e) => updateFilters({ zone: e.target.value, page: '1' })}
              className={cn(
                'w-full appearance-none rounded-md border bg-field px-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All Zones</option>
              {ZONE_OPTIONS.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        )}

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
      {customersQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load customers. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<Customer>
        tableId="customers"
        exportConfig={{ title: 'Customers' }}
        columns={columns}
        data={customers}
        isLoading={customersQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No customers found matching your search."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
