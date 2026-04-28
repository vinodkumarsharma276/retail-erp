import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  ChevronDown,
  Calendar,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePurchasesQuery } from '../../hooks/usePurchases';
import { useDistributorsQuery } from '../../hooks/useDistributors';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type { Purchase } from '@retailerp/shared-types';
import { usePermission } from '../../hooks/usePermission';

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

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const distributorId = searchParams.get('distributorId') || '';
  const dateFrom = searchParams.get('dateFrom') || getDateDaysAgo(30);
  const dateTo = searchParams.get('dateTo') || getToday();
  const paymentStatus = searchParams.get('paymentStatus') || '';

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
  });

  // Distributors for the filter dropdown (load all for dropdown)
  const distributorsQuery = useDistributorsQuery({ page: 1, pageSize: 100 });
  const distributorOptions = distributorsQuery.data?.data ?? [];

  const purchases = purchasesQuery.data?.data ?? [];
  const pagination = purchasesQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = distributorId || paymentStatus || dateFrom !== getDateDaysAgo(90) || dateTo !== getToday();
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // ------ Table columns ------
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
      key: 'date',
      header: 'Date',
      sortable: true,
      sortAccessor: (row) => new Date(row.invoiceDate),
      render: (row) => formatDateIN(row.invoiceDate),
    },
    {
      key: 'distributor',
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
      render: (row) => formatINR(row.gstAmount),
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
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Purchases</h1>
        {canCreate && (
          <Link
            to="/purchases/new"
            className={cn(
              'flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
            )}
          >
            <Plus className="h-4 w-4" />
            New Purchase
          </Link>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
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
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
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
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                updateFilters({ dateFrom: e.target.value, page: '1' });
              }}
              className={cn(
                'rounded-md border bg-background pl-9 pr-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>
        </div>

        {/* Date to */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            To
          </label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                updateFilters({ dateTo: e.target.value, page: '1' });
              }}
              className={cn(
                'rounded-md border bg-background pl-9 pr-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>
        </div>

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
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
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

      {/* Data table */}
      <DataTable<Purchase>
        columns={columns}
        data={purchases}
        isLoading={purchasesQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No purchases found matching your filters."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
