import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  ChevronDown,
  
  X,
  Trash2,
  Search,
  FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { usePurchasesQuery, useDeletePurchasesMutation } from '../../hooks/usePurchases';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../stores/toast-store';
import { useState } from 'react';
import { useDistributorsQuery } from '../../hooks/useDistributors';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { DateInput } from '../../components/DateInput';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN, getCurrentFinancialYearRange, getLastFinancialYearRange } from '@retailerp/shared-utils';
import type { Purchase } from '@retailerp/shared-types';
import { usePermission } from '../../hooks/usePermission';
import { useShopStore, isAllShops } from '../../stores/shop-store';

const PAGE_SIZE = 20;

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export function PurchaseListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = usePermission('purchases.create');
  const canViewDetail = usePermission('purchases.detail');
  const canDelete = usePermission('purchases.delete');
  // What is still owed on each purchase. Its own permission, because seeing
  // a purchase and seeing what the shop still owes on it are different
  // things — the column was shown to everyone until now.
  const canSeePending = usePermission('purchases.view_pending_amount');
  const toast = useToast();

  // Kept by id, so a tick survives sorting, paging and refetching.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteMut = useDeletePurchasesMutation();

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const distributorId = searchParams.get('distributorId') || '';
  const search = searchParams.get('search') || '';
  // When searching by invoice number we ignore the default 30-day window so
  // the lookup spans the full history. The user can still set dates manually.
  const dateFrom = searchParams.get('dateFrom') || (search ? '' : getDateDaysAgo(30));
  const dateTo = searchParams.get('dateTo') || (search ? '' : getToday());
  const paymentStatus = searchParams.get('paymentStatus') || '';
  const source = searchParams.get('source') || '';

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

  // Purchases query
  const purchasesQuery = usePurchasesQuery({
    page,
    pageSize: PAGE_SIZE,
    distributorId: distributorId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    paymentStatus: paymentStatus || undefined,
    search: search || undefined,
    source: source || undefined,
  });

  // Distributors for the filter dropdown (load all for dropdown)
  const distributorsQuery = useDistributorsQuery({ page: 1, pageSize: 100 });
  const distributorOptions = distributorsQuery.data?.data ?? [];

  const purchases = purchasesQuery.data?.data ?? [];
  const pagination = purchasesQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = distributorId || paymentStatus || source || search || dateFrom !== getDateDaysAgo(30) || dateTo !== getToday();
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // ------ Table columns ------
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));

  const columns: Column<Purchase>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) =>
        pagination
          ? (pagination.page - 1) * pagination.pageSize + idx + 1
          : idx + 1,
      className: 'w-16',
    },
    // Shop column — only visible in "All Shops" mode.
    ...(allShopsMode
      ? ([
          {
            key: 'shop' as keyof Purchase,
            header: 'Shop',
            sortable: true,
            sortAccessor: (row: Purchase) => (row as any).shop?.code ?? '',
            render: (row: Purchase) => {
              const s = (row as any).shop as { code: string } | null | undefined;
              return s ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                  {s.code}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              );
            },
            className: 'w-20',
          },
        ] as Column<Purchase>[])
      : []),
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      sortable: true,
      sortAccessor: (row) => row.invoiceNumber,
      render: (row) =>
        canViewDetail ? (
          <button
            onClick={() => navigate(`/purchases/${row.id}`)}
            className="font-mono text-xs text-primary hover:underline text-left"
          >
            {row.invoiceNumber}
          </button>
        ) : (
          <span className="font-mono text-xs">{row.invoiceNumber}</span>
        ),
    },
    {
      key: 'source',
      header: 'Source',
      sortable: true,
      sortAccessor: (row) => row.source ?? 'manual',
      // Imported invoices are worth telling apart at a glance: their product
      // details came from a sheet, so they are the ones to check first.
      render: (row) =>
        row.source === 'excel_import' ? (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-primary-muted px-2 py-0.5 text-xs font-medium text-primary"
            title="Imported from a spreadsheet"
          >
            <FileSpreadsheet className="h-3 w-3" />
            Imported
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Entered</span>
        ),
      className: 'w-28',
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      sortAccessor: (row) => new Date(row.invoiceDate),
      render: (row) => formatDateIN(row.invoiceDate),
    },
    {
      key: 'distributor',
      // The long text on this row, so spare width lands where it reads.
      flexible: true,
      header: 'Distributor',
      sortable: true,
      sortAccessor: (row) => row.distributor?.companyName ?? '',
      render: (row) => (
        <span className="font-medium">
          {row.distributor?.companyName ?? '-'}
        </span>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Total',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.totalAmount) || 0,
      render: (row) => formatINR(row.totalAmount),
    },
    {
      key: 'gstAmount',
      header: 'GST',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.gstAmount) || 0,
      // Goods bought without a bill carry no tax at all, which is not the
      // same thing as a bill that happened to add up to zero.
      render: (row) =>
        row.billed === false ? (
          <span className="text-xs text-muted-foreground" title="Bought without a bill">
            No bill
          </span>
        ) : (
          formatINR(row.gstAmount)
        ),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.amountPaid) || 0,
      render: (row) => formatINR(row.amountPaid),
    },
    {
      key: 'pending',
      header: 'Pending',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => (Number(row.netAmount) || 0) - (Number(row.amountPaid) || 0),
      render: (row) => {
        const pending = (Number(row.netAmount) || 0) - (Number(row.amountPaid) || 0);
        return (
          <span className={cn(pending > 0 && 'text-red-600 font-medium')}>
            {formatINR(pending)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortAccessor: (row) => row.paymentStatus,
      render: (row) => <StatusBadge status={row.paymentStatus} />,
    },
  ];

  // ------ Pagination state ------
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
        title="Purchases"
        description="Invoices from distributors, and what you still owe on them."
        actions={
          canCreate &&
          (allShopsMode ? (
            <Button disabled title="Switch to a single shop to record a purchase" icon={<Plus className="h-3.5 w-3.5" />}>
              New purchase
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link to="/purchases/import">
                <Button variant="outline" icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>Import from Excel</Button>
              </Link>
              <Link to="/purchases/new">
                <Button icon={<Plus className="h-3.5 w-3.5" />}>New purchase</Button>
              </Link>
            </div>
          ))
        }
      />

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        {/* Invoice search */}
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search invoice #
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              placeholder="Invoice number..."
              onChange={(e) => updateFilters({ search: e.target.value, page: '1' })}
              className={cn(
                'w-full rounded-md border bg-field py-2 pl-8 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
            {search && (
              <button
                type="button"
                onClick={() => updateFilters({ search: '', page: '1' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Distributor dropdown */}
        <div className="min-w-[200px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Distributor
          </label>
          <div className="relative">
            <select
              value={distributorId}
              onChange={(e) => {
                updateFilters({ distributorId: e.target.value, page: '1' });
              }}
              className={cn(
                'w-full appearance-none rounded-md border bg-field px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All Distributors</option>
              {distributorOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.companyName}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Date from */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            From
          </label>
          <DateInput
            value={dateFrom}
            onChange={(v) => updateFilters({ dateFrom: v, page: '1' })}
            className="w-40"
          />
        </div>

        {/* Date to */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            To
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

        {/* Payment Status */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Payment Status
          </label>
          <div className="relative">
            <select
              value={paymentStatus}
              onChange={(e) => {
                updateFilters({ paymentStatus: e.target.value, page: '1' });
              }}
              className={cn(
                'w-full appearance-none rounded-md border bg-field px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Where it came from */}
        <div className="w-full sm:w-40">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Entered
          </label>
          <div className="relative">
            <select
              value={source}
              onChange={(e) => {
                updateFilters({ source: e.target.value, page: '1' });
              }}
              className={cn(
                'w-full appearance-none rounded-md border bg-field px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">Any way</option>
              <option value="manual">By hand</option>
              <option value="excel_import">From a sheet</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Clear Filters
          </button>
        )}
      </div>

      {/* Error state */}
      {purchasesQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load purchases. Please try again.
        </div>
      )}

      {/* What to do with the ticked ones */}
      {canDelete && picked.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium">
            {picked.size} purchase{picked.size === 1 ? '' : 's'} selected
          </span>
          <Button variant="outline" size="sm" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            loading={deleteMut.isPending}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
          <span className="text-xs text-muted-foreground">
            The units they brought in go too.
          </span>
        </div>
      )}

      {/* Data table */}
      <DataTable<Purchase>
        tableId="purchases"
        exportConfig={{ title: 'Purchases' }}
        columns={columns.filter((column) => column.key !== 'pending' || canSeePending)}
        data={purchases}
        isLoading={purchasesQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No purchases found matching your filters."
        rowKey={(row) => row.id}
        selection={
          canDelete
            ? {
                selected: picked,
                onChange: setPicked,
                disabledReason: (row) =>
                  Number(row.amountPaid) > 0
                    ? 'Has payments recorded against it'
                    : null,
              }
            : undefined
        }
      />

      <ConfirmDialog
        isOpen={confirmingDelete}
        title={`Delete ${picked.size} purchase${picked.size === 1 ? '' : 's'}?`}
        message="The units these purchases brought in are deleted with them. Anything already sold or transferred will stop this, and nothing will be deleted."
        confirmText="Delete"
        variant="danger"
        loading={deleteMut.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          deleteMut.mutate(Array.from(picked), {
            onSuccess: (result) => {
              toast.success(
                `Deleted ${result.purchases} purchase${result.purchases === 1 ? '' : 's'} and ${result.units} unit${result.units === 1 ? '' : 's'}.`,
              );
              setPicked(new Set());
              setConfirmingDelete(false);
            },
            onError: (error) => {
              const e = error as { response?: { data?: { error?: string; message?: string } }; message?: string };
              toast.error(
                e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Could not delete.',
              );
              setConfirmingDelete(false);
            },
          });
        }}
      />
    </div>
  );
}
