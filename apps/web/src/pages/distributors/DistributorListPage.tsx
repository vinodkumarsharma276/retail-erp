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
  useAllDistributorIds,
  useAllDistributors,
} from '../../hooks/useDistributors';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState, SortDir } from '../../components/DataTable';
import { formatINR } from '@retailerp/shared-utils';
import type { DistributorListItem } from '@retailerp/shared-types';
import { IncompleteDetailsBadge } from '../../components/IncompleteDetailsBadge';
import { distributorCompleteness } from '../../lib/distributor-completeness';
import { isAllShops, useShopStore } from '../../stores/shop-store';

const PAGE_SIZE = 20;

export type DistributorSortKey =
  | 'companyName'
  | 'pendingPayment'
  | 'totalPaymentPaid'
  | 'totalProductsPurchased';

/**
 * The orders worth offering, and what each one is called when you are
 * looking for it. The column headers do the same thing; this is for when
 * the column you want to sort by is off the right-hand edge.
 */
const DISTRIBUTOR_SORTS: Array<{ key: DistributorSortKey; label: string; dir: SortDir }> = [
  { key: 'companyName', label: 'Name (A–Z)', dir: 'asc' },
  { key: 'pendingPayment', label: 'Pending — most owed first', dir: 'desc' },
  { key: 'totalPaymentPaid', label: 'Total paid — highest first', dir: 'desc' },
  { key: 'totalProductsPurchased', label: 'Products purchased — most first', dir: 'desc' },
];

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
  /**
   * The ticked rows themselves, kept as they are ticked.
   *
   * A row can only be ticked while it is on screen, so remembering it here
   * is what lets a selection survive paging. Filtering the current page by
   * the ticked ids instead would quietly drop everything ticked on another
   * page — and Merge would then fold together fewer suppliers than the
   * screen said it would.
   */
  const [pickedRowCache, setPickedRowCache] = useState<Map<string, DistributorListItem>>(new Map());
  /** True once the user asks for every supplier matching, not just this page. */
  const [allMatchingPicked, setAllMatchingPicked] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [merging, setMerging] = useState(false);
  const deleteMut = useDeleteDistributorsMutation();
  const mergeMut = useMergeDistributorsMutation();
  const impactMut = useDistributorDeletionImpact();
  const fetchAllIds = useAllDistributorIds();
  const fetchAllDistributors = useAllDistributors();
  const toast = useToast();

  const clearPicked = () => {
    setPicked(new Set());
    setPickedRowCache(new Map());
    setAllMatchingPicked(false);
  };

  /** Keep the remembered rows in step with the ticked ids. */
  const changePicked = (next: Set<string>) => {
    setPicked(next);
    setPickedRowCache((prev) => {
      const kept = new Map<string, DistributorListItem>();
      for (const id of next) {
        const known = prev.get(id) ?? distributors.find((d) => d.id === id);
        if (known) kept.set(id, known);
      }
      return kept;
    });
    // Un-ticking anything means this is no longer "all of them".
    if (next.size < picked.size) setAllMatchingPicked(false);
  };

  /**
   * Tick every supplier the current search matches, not just the page.
   *
   * The ids are fetched rather than inferred: the server decides what
   * matches, and the delete that follows names each id explicitly so there
   * is no "delete everything matching" call to get wrong.
   */
  const pickAllMatching = async () => {
    setSelectingAll(true);
    try {
      const ids = await fetchAllIds({ search: debouncedSearch.length >= 3 ? debouncedSearch : undefined });
      setPicked(new Set(ids));
      setAllMatchingPicked(true);
      // Rows for the other pages are not loaded; merge needs them, so it
      // steps aside while the whole list is picked.
      setPickedRowCache(new Map());
    } catch {
      toast.error('Could not select every distributor. Try again.');
    } finally {
      setSelectingAll(false);
    }
  };

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

  // The order is the server's business, not the table's: it has to hold
  // across pages, so it lives in the URL and goes with the request.
  const sortBy = (DISTRIBUTOR_SORTS.find((s) => s.key === searchParams.get('sortBy'))?.key
    ?? 'companyName') as DistributorSortKey;
  const sortDir: SortDir =
    searchParams.get('sortDir') === 'asc' || searchParams.get('sortDir') === 'desc'
      ? (searchParams.get('sortDir') as SortDir)
      : sortBy === 'companyName'
        ? 'asc'
        : 'desc';

  /** Re-ordering the whole list means the page you were on is meaningless. */
  const applySort = (key: string, dir: SortDir) =>
    updateFilters({ sortBy: key, sortDir: dir, page: '1' });

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
    sortBy,
    sortDir,
  });

  const distributors = distributorsQuery.data?.data ?? [];
  const pagination = distributorsQuery.data?.pagination;

  /** Every ticked supplier, including ones ticked on another page. */
  const pickedRows = [...pickedRowCache.values()];
  /** Ticked suppliers whose stock would go down with them. */
  const pickedWithHistory = pickedRows.filter(hasHistory);

  const totalItems = pagination?.totalItems ?? distributors.length;
  const everyRowOnPagePicked =
    distributors.length > 0 && distributors.every((row) => picked.has(row.id));
  /** Worth offering "select all" only when there is more than this page. */
  const canOfferSelectAll =
    everyRowOnPagePicked && !allMatchingPicked && totalItems > distributors.length;

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
      // The long text on this row, so spare width lands where it reads.
      flexible: true,
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
      key: 'totalProductsPurchased',
      header: 'Products Purchased',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.totalProductsPurchased) || 0,
      render: (row) => row.totalProductsPurchased,
    },
    {
      key: 'totalPaymentPaid',
      header: 'Total Paid',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.totalPaymentPaid) || 0,
      render: (row) => formatINR(row.totalPaymentPaid),
    },
    {
      key: 'pendingPayment',
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
      // The only way to act on a row; hiding it would strand the row.
      alwaysVisible: true,
      exportable: false,
      resizable: false,
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
        // The count is in the heading, not only at the foot of the table:
        // after a delete the page refills with the next twenty, and without
        // a number in sight nothing looks to have happened.
        description={
          distributorsQuery.isLoading
            ? 'Suppliers you buy stock from, with outstanding payables.'
            : `${totalItems} supplier${totalItems === 1 ? '' : 's'} you buy stock from, with outstanding payables.`
        }
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

        {/* Order of the whole list, not of the page on screen */}
        <div className="min-w-[240px]">
          <label
            htmlFor="distributor-sort"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Sort by
          </label>
          <select
            id="distributor-sort"
            value={sortBy}
            onChange={(e) => {
              const chosen = DISTRIBUTOR_SORTS.find((s) => s.key === e.target.value);
              if (chosen) applySort(chosen.key, chosen.dir);
            }}
            className={cn(
              'w-full rounded-md border bg-field px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            )}
          >
            {DISTRIBUTOR_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
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
              {allMatchingPicked
                ? `All ${picked.size} distributor${picked.size === 1 ? '' : 's'} selected`
                : `${picked.size} distributor${picked.size === 1 ? '' : 's'} selected`}
            </span>
            <Button variant="outline" size="sm" onClick={clearPicked}>
              Clear
            </Button>
            {canMerge && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMerging(true)}
                disabled={picked.size < 2 || allMatchingPicked}
                title={
                  allMatchingPicked
                    ? 'Merging is for a handful you have looked at, not the whole list'
                    : picked.size < 2
                      ? 'Tick at least two to merge them'
                      : undefined
                }
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

          {/* Ticking the box at the top of the table takes this page only,
              which is not what "select all" looks like it does. */}
          {canOfferSelectAll && (
            <p className="mt-2 text-xs text-muted-foreground">
              All {distributors.length} on this page are selected.{' '}
              <button
                type="button"
                onClick={() => void pickAllMatching()}
                disabled={selectingAll}
                className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-60"
              >
                {selectingAll
                  ? 'Selecting...'
                  : `Select all ${totalItems}${searchText ? ' matching this search' : ''}`}
              </button>
            </p>
          )}

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
        tableId="distributors"
        exportConfig={{
          title: 'Distributors',
          subtitle: [
            searchText ? `Search: ${searchText}` : null,
            `Sorted by ${DISTRIBUTOR_SORTS.find((s) => s.key === sortBy)?.label ?? sortBy}`,
            `${totalItems} supplier${totalItems === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · '),
          totalCount: totalItems,
          fetchAll: () =>
            fetchAllDistributors({
              search: debouncedSearch.length >= 3 ? debouncedSearch : undefined,
              sortBy,
              sortDir,
            }),
        }}
        columns={columns}
        data={distributors}
        isLoading={distributorsQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No distributors found matching your search."
        rowKey={(row) => row.id}
        // Clicking a header reorders every distributor, not the twenty here.
        serverSort={{ key: sortBy, dir: sortDir, onChange: applySort }}
        selection={
          canPick
            ? {
                // Every row is tickable: a supplier with history cannot be
                // deleted on its own, but merging it is what it is here for.
                selected: picked,
                onChange: changePicked,
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
                  clearPicked();
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
                  clearPicked();
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
