import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useCanCheck } from '../../hooks/usePermission';
import { Plus, Search, X, Pencil, Receipt, Trash2, Info, Merge, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { DeleteDistributorsDialog } from '../../components/DeleteDistributorsDialog';
import { MergeDistributorsDialog } from '../../components/MergeDistributorsDialog';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../stores/toast-store';
import {
  useDistributorsQuery,
  useDeleteDistributorsMutation,
  useMergeDistributorsMutation,
  useDistributorDeletionImpact,
} from '../../hooks/useDistributors';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { formatINR } from '@retailerp/shared-utils';
import type { DistributorListItem } from '@retailerp/shared-types';
import { IncompleteDetailsBadge } from '../../components/IncompleteDetailsBadge';
import { distributorCompleteness } from '../../lib/distributor-completeness';
import { isAllShops, useShopStore } from '../../stores/shop-store';

const PAGE_SIZE = 20;

export function DistributorListPage() {
  const navigate = useNavigate();
  const can = useCanCheck();
  const [searchParams, setSearchParams] = useSearchParams();

  // A purchase belongs to one shop's books, so the shortcut is out while the
  // header is showing every shop at once.
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));

  // ------ Ticking rows off to act on several at once ------
  const canDelete = can('distributors.delete');
  const canMerge = can('distributors.merge');
  const canPick = canDelete || canMerge;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [merging, setMerging] = useState(false);
  const deleteMut = useDeleteDistributorsMutation();
  const mergeMut = useMergeDistributorsMutation();
  const impactMut = useDistributorDeletionImpact();
  const toast = useToast();

  /**
   * The counts come from the server, not from the list's own figures: the
   * list knows products but not invoices, and both change under it.
   */
  const openDeleteDialog = () => {
    setConfirmingDelete(true);
    impactMut.mutate(Array.from(picked), {
      onError: () => {
        toast.error('Could not work out what deleting these would remove.');
        setConfirmingDelete(false);
      },
    });
  };

  /**
   * Stock bought from a supplier is what stops it being deleted — the
   * purchases would be left pointing at nobody. It does not stop it being
   * merged, which is the whole point of merging: the purchases move first.
   */
  const hasHistory = (row: DistributorListItem) => row.totalProductsPurchased > 0;

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

  const pickedRows = distributors.filter((row) => picked.has(row.id));
  /** Ticked suppliers that cannot be deleted, only merged. */
  const pickedWithHistory = pickedRows.filter(hasHistory);

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
        <span className="inline-flex items-center gap-1.5">
          <button
            onClick={() => navigate(`/distributors/${row.id}`)}
            className="font-medium text-primary hover:underline text-left"
          >
            {row.companyName}
          </button>
          <IncompleteDetailsBadge completeness={distributorCompleteness(row)} />
        </span>
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
          {can('purchases.create') && !allShopsMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/purchases/new?distributorId=${row.id}`);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="New purchase from this distributor"
          >
            <Receipt className="h-4 w-4" />
          </button>
          )}
          {can('distributors.edit') && (
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
        title="Distributors"
        description="Suppliers you buy stock from, with outstanding payables."
        actions={
          can('distributors.create') && (
            <div className="flex flex-wrap gap-2">
              <Link to="/distributors/import">
                <Button
                  variant="outline"
                  icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
                >
                  Import from Excel
                </Button>
              </Link>
              <Link to="/distributors/new">
                <Button icon={<Plus className="h-3.5 w-3.5" />}>Add distributor</Button>
              </Link>
            </div>
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

      {/* What to do with the ticked ones */}
      {canPick && picked.size > 0 && (
        <div className="mb-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {picked.size} distributor{picked.size === 1 ? '' : 's'} selected
            </span>
            <Button variant="outline" size="sm" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
            {canMerge && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMerging(true)}
                disabled={picked.size < 2}
                title={picked.size < 2 ? 'Tick at least two to merge them' : undefined}
              >
                <Merge className="mr-1 h-3.5 w-3.5" />
                Merge
              </Button>
            )}
            {canDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={openDeleteDialog}
                loading={deleteMut.isPending}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>

          {/* The two actions look alike from here, so say what separates
              them before the user picks the destructive one. */}
          {pickedWithHistory.length > 0 && canMerge && (
            <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Stock has been bought from{' '}
                {pickedWithHistory.length === picked.size
                  ? picked.size === 1
                    ? 'this supplier'
                    : 'all of these'
                  : `${pickedWithHistory.length} of these`}
                , so deleting takes their invoices and stock with them. To keep the stock
                and only lose the duplicate name, merge instead.
              </span>
            </p>
          )}
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
        selection={
          canPick
            ? {
                // Every row is tickable: a supplier with history cannot be
                // deleted, but merging it is exactly what it is here for.
                selected: picked,
                onChange: setPicked,
              }
            : undefined
        }
      />

      {confirmingDelete && (
        <DeleteDistributorsDialog
          impact={impactMut.data ?? null}
          loading={deleteMut.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={(cascade) => {
            deleteMut.mutate(
              { ids: Array.from(picked), cascade },
              {
                onSuccess: (result) => {
                  toast.success(
                    result.purchases
                      ? `Deleted ${result.distributors} distributor${result.distributors === 1 ? '' : 's'}, ` +
                          `${result.purchases} invoice${result.purchases === 1 ? '' : 's'} and ` +
                          `${result.units} unit${result.units === 1 ? '' : 's'}.`
                      : `Deleted ${result.distributors} distributor${result.distributors === 1 ? '' : 's'}.`,
                  );
                  setPicked(new Set());
                  setConfirmingDelete(false);
                },
                onError: (error) => {
                  const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
                  toast.error(
                    e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Could not delete.',
                  );
                },
              },
            );
          }}
        />
      )}

      {merging && (
        <MergeDistributorsDialog
          candidates={pickedRows}
          loading={mergeMut.isPending}
          onCancel={() => setMerging(false)}
          onConfirm={(targetId) => {
            mergeMut.mutate(
              { sourceIds: pickedRows.filter((d) => d.id !== targetId).map((d) => d.id), targetId },
              {
                onSuccess: (result) => {
                  toast.success(
                    `Merged ${result.merged} distributor${result.merged === 1 ? '' : 's'} into ${result.keptName}. ` +
                      `${result.purchases} purchase${result.purchases === 1 ? '' : 's'} and ${result.products} product${result.products === 1 ? '' : 's'} moved across.`,
                  );
                  setPicked(new Set());
                  setMerging(false);
                },
                onError: (error) => {
                  const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
                  toast.error(
                    e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Could not merge.',
                  );
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}
