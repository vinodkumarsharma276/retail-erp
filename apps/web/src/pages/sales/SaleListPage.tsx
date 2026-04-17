import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, ChevronDown, Download, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useSalesQuery } from '../../hooks/useSales';
import type { SaleListItem } from '../../hooks/useSales';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { SaleType } from '@retailerp/shared-types';
import { handleInvoiceDownload } from '../../lib/invoice-utils';

const PAGE_SIZE = 20;

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

const SALE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: SaleType.FULL_PAYMENT, label: 'Full Payment' },
  { value: SaleType.PARTIAL_WITH_PROMISE, label: 'Partial with Promise' },
  { value: SaleType.SELF_FINANCE, label: 'Self Finance' },
  { value: SaleType.COMPANY_FINANCE, label: 'Company Finance' },
];

export function SaleListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const customerSearch = searchParams.get('customerSearch') || '';
  const debouncedCustomerSearch = useDebounce(customerSearch, 300);
  const saleType = searchParams.get('saleType') || '';
  const dateFrom = searchParams.get('dateFrom') || getDateDaysAgo(90);
  const dateTo = searchParams.get('dateTo') || getToday();

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

  // Sales query
  const salesQuery = useSalesQuery({
    page,
    pageSize: PAGE_SIZE,
    saleType: saleType || undefined,
    customerSearch: debouncedCustomerSearch.length >= 2 ? debouncedCustomerSearch : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const sales = salesQuery.data?.data ?? [];
  const pagination = salesQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters = !!customerSearch || !!saleType || dateFrom !== getDateDaysAgo(90) || dateTo !== getToday();
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // ------ Resolve payment status ------
  const getPaymentStatus = (sale: SaleListItem): string => {
    switch (sale.saleType) {
      case 'full_payment':
        return 'paid';
      case 'partial_with_promise':
        return sale.pendingAmount > 0 ? 'pending' : 'paid';
      case 'self_finance': {
        const schedule = (sale as any).installmentSchedule;
        return schedule?.status || 'active';
      }
      case 'company_finance':
        return sale.financePaymentStatus || 'pending';
      default:
        return 'paid';
    }
  };

  // ------ Download invoice handler ------
  const onDownloadInvoice = async (saleId: string) => {
    setDownloadingId(saleId);
    try {
      await handleInvoiceDownload(saleId);
    } catch (err) {
      console.error('Invoice download failed:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  // ------ Table columns ------
  const columns: Column<SaleListItem>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) =>
        pagination
          ? (pagination.page - 1) * pagination.pageSize + idx + 1
          : idx + 1,
      className: 'w-12',
    },
    {
      key: 'saleNumber',
      header: 'Sale #',
      render: (row) => (
        <button
          onClick={() => navigate(`/sales/${row.id}`)}
          className="font-mono text-xs font-medium text-primary hover:underline text-left"
        >
          {row.saleNumber}
        </button>
      ),
    },
    {
      key: 'ledgerNumber',
      header: 'Ledger #',
      render: (row) => (
        <span className="font-mono text-xs">{row.ledgerNumber}</span>
      ),
    },
    {
      key: 'saleDate',
      header: 'Date',
      render: (row) => formatDateIN(row.saleDate),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => {
        const c = (row as any).customer;
        return (
          <div>
            <p className="text-sm font-medium">{c?.name || row.customerName || '-'}</p>
            {(c?.customerCode || row.customerCode) && (
              <p className="text-xs text-muted-foreground">{c?.customerCode || row.customerCode}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'product',
      header: 'Product',
      render: (row) => {
        const p = (row as any).product;
        return (
          <span className="text-sm">
            {p?.brand || row.productBrand || ''} {p?.modelNumber || row.productModel || '-'}
          </span>
        );
      },
    },
    {
      key: 'saleType',
      header: 'Sale Type',
      render: (row) => <StatusBadge status={row.saleType} />,
    },
    {
      key: 'totalAmount',
      header: 'Total',
      align: 'right',
      render: (row) => (
        <span className="font-medium">{formatINR(row.totalAmount)}</span>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (row) => <StatusBadge status={getPaymentStatus(row)} />,
    },
    {
      key: 'createdBy',
      header: 'Created By',
      render: (row) => {
        const creator = (row as any).creator;
        return (
          <span className="text-xs text-muted-foreground">{creator?.fullName || creator?.username || '-'}</span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-10',
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownloadInvoice(row.id);
          }}
          disabled={downloadingId === row.id}
          title="Download Invoice"
          className={cn(
            'rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {downloadingId === row.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
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
        <h1 className="text-2xl font-semibold">Sales</h1>
        {/* Hidden for now — sales initiated from Products page "Sell" button */}
        {/* <Link
          to="/sales/new"
          className={cn(
            'flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
            'hover:bg-primary/90 transition-colors',
          )}
        >
          <Plus className="h-4 w-4" />
          New Sale
        </Link> */}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        {/* Customer search */}
        <div className="min-w-[240px] flex-1 max-w-sm">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Customer
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => {
                updateFilters({ customerSearch: e.target.value, page: '1' });
              }}
              placeholder="Name or phone (min 2 chars)..."
              className={cn(
                'w-full rounded-md border bg-background pl-9 pr-8 py-2 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
            {customerSearch && (
              <button
                onClick={() => {
                  updateFilters({ customerSearch: '', page: '1' });
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Sale type filter */}
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Sale Type
          </label>
          <div className="relative">
            <select
              value={saleType}
              onChange={(e) => {
                updateFilters({ saleType: e.target.value, page: '1' });
              }}
              className={cn(
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              {SALE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Date from */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              updateFilters({ dateFrom: e.target.value, page: '1' });
            }}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            )}
          />
        </div>

        {/* Date to */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              updateFilters({ dateTo: e.target.value, page: '1' });
            }}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            )}
          />
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
      {salesQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load sales. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<SaleListItem>
        columns={columns}
        data={sales}
        isLoading={salesQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No sales found matching your filters."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
