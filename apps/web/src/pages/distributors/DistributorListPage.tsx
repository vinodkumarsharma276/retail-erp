import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, X, Pencil } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useDistributorsQuery } from '../../hooks/useDistributors';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { formatINR } from '@retailerp/shared-utils';
import type { DistributorListItem } from '@retailerp/shared-types';

const PAGE_SIZE = 20;

export function DistributorListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const searchText = searchParams.get('search') || '';
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

  // Distributors query
  const distributorsQuery = useDistributorsQuery({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch.length >= 3 ? debouncedSearch : undefined,
  });

  const distributors = distributorsQuery.data?.data ?? [];
  const pagination = distributorsQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = !!searchText;
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // ------ Table columns ------
  const columns: Column<DistributorListItem>[] = [
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
      key: 'companyName',
      header: 'Company Name',
      sortable: true,
      sortAccessor: (row) => row.companyName,
      render: (row) => (
        <button
          onClick={() => navigate(`/distributors/${row.id}`)}
          className="font-medium text-primary hover:underline text-left"
        >
          {row.companyName}
        </button>
      ),
    },
    {
      key: 'contactPerson',
      header: 'Contact Person',
      sortable: true,
      sortAccessor: (row) => row.contactPerson ?? '',
      render: (row) => row.contactPerson,
    },
    {
      key: 'phone',
      header: 'Phone',
      sortable: true,
      sortAccessor: (row) => row.phone ?? '',
      render: (row) => (
        <div>
          <p>{row.phone}</p>
          {row.altPhone && <p className="text-xs text-muted-foreground">{row.altPhone}</p>}
        </div>
      ),
    },
    {
      key: 'gstNumber',
      header: 'GST Number',
      sortable: true,
      sortAccessor: (row) => row.gstNumber ?? '',
      render: (row) => (
        <span className="font-mono text-xs">{row.gstNumber || '-'}</span>
      ),
    },
    {
      key: 'totalProducts',
      header: 'Products Purchased',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.totalProductsPurchased) || 0,
      render: (row) => row.totalProductsPurchased,
    },
    {
      key: 'totalPaid',
      header: 'Total Paid',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.totalPaymentPaid) || 0,
      render: (row) => formatINR(row.totalPaymentPaid),
    },
    {
      key: 'pending',
      header: 'Pending',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.pendingPayment) || 0,
      render: (row) => (
        <span
          className={cn(
            row.pendingPayment > 0 && 'text-red-600 font-medium',
          )}
        >
          {formatINR(row.pendingPayment)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/distributors/${row.id}/edit`);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Edit distributor"
          >
            <Pencil className="h-4 w-4" />
          </button>
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
        title="Distributors"
        description="Suppliers you buy stock from, with outstanding payables."
        actions={
          <Link to="/distributors/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />}>Add distributor</Button>
          </Link>
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
              placeholder="Company name, phone, or GST (min 3 chars)..."
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
      {distributorsQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load distributors. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<DistributorListItem>
        columns={columns}
        data={distributors}
        isLoading={distributorsQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No distributors found matching your search."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
