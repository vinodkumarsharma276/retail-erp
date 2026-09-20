import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  ChevronDown,
  Calendar,
  X,
  Search,
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { usePurchasesQuery } from '../../hooks/usePurchases';
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

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const distributorId = searchParams.get('distributorId') || '';
  const search = searchParams.get('search') || '';
  // When searching by invoice number we ignore the default 30-day window so
  // the lookup spans the full history. The user can still set dates manually.
  const dateFrom = searchParams.get('dateFrom') || (search ? '' : getDateDaysAgo(30));
  const dateTo = searchParams.get('dateTo') || (search ? '' : getToday());
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
    search: search || undefined,
  });

  // Distributors for the filter dropdown (load all for dropdown)
  const distributorsQuery = useDistributorsQuery({ page: 1, pageSize: 100 });
  const distributorOptions = distributorsQuery.data?.data ?? [];

  const purchases = purchasesQuery.data?.data ?? [];
  const pagination = purchasesQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = distributorId || paymentStatus || search || dateFrom !== getDateDaysAgo(30) || dateTo !== getToday();
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
            <Link to="/purchases/new">
              <Button icon={<Plus className="h-3.5 w-3.5" />}>New purchase</Button>
            </Link>
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
                'w-full rounded-md border bg-background py-2 pl-8 pr-8 text-sm',
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
