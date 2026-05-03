import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, ChevronDown, Download, Loader2, ScanLine } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useSalesQuery } from '../../hooks/useSales';
import type { SaleListItem } from '../../hooks/useSales';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { CompletionBadge } from '../../components/CompletionBadge';
import { formatINR, formatDateIN, getCurrentFinancialYearRange, getLastFinancialYearRange } from '@retailerp/shared-utils';
import { SaleType } from '@retailerp/shared-types';
import { handleInvoiceDownload } from '../../lib/invoice-utils';
import { usePermission, useCanCheck } from '../../hooks/usePermission';
import { AccessDenied } from '../../routes/RoleGuard';
import { useShopStore, isAllShops } from '../../stores/shop-store';

const PAGE_SIZE = 20;

function getLastMonthStart(): string {
  const d = new Date();
  // One month back from today (same day-of-month, handles month rollover).
  const start = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today (YYYY-MM-DD). */
function getLastMonthEnd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SALE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: SaleType.FULL_PAYMENT, label: 'Full Payment' },
  { value: SaleType.PARTIAL_WITH_PROMISE, label: 'Partial with Promise' },
  { value: SaleType.SELF_FINANCE, label: 'Self Finance' },
  { value: SaleType.COMPANY_FINANCE, label: 'Company Finance' },
];

export function SaleListPage() {
  const canListSales = usePermission('sales.list');
  if (!canListSales) return <AccessDenied />;
  return <SaleListPageInner />;
}

function SaleListPageInner() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const can = useCanCheck();

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const customerSearch = searchParams.get('customerSearch') || '';
  const debouncedCustomerSearch = useDebounce(customerSearch, 300);
  const saleType = searchParams.get('saleType') || '';
  const defaultDateFrom = getLastMonthStart();
  const defaultDateTo = getLastMonthEnd();
  const dateFrom = searchParams.get('dateFrom') || defaultDateFrom;
  const dateTo = searchParams.get('dateTo') || defaultDateTo;
  // Profit% filter (only meaningful for users who can see profit numbers).
  const canSeeProfit = can('sales.section.profit');
  const maxProfitPctRaw = searchParams.get('maxProfitPct') || '';
  const maxProfitPct =
    canSeeProfit && maxProfitPctRaw !== '' && Number.isFinite(Number(maxProfitPctRaw))
      ? Number(maxProfitPctRaw)
      : undefined;
  // When user is actively searching, ignore the date range so matches aren't hidden.
  const isSearching = customerSearch.trim().length > 0;

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
    dateFrom: isSearching ? undefined : dateFrom || undefined,
    dateTo: isSearching ? undefined : dateTo || undefined,
    maxProfitPct,
  });

  const sales = salesQuery.data?.data ?? [];
  const pagination = salesQuery.data?.pagination;

  // ------ Clear filters ------
  const hasFilters =
    !!customerSearch ||
    !!saleType ||
    dateFrom !== defaultDateFrom ||
    dateTo !== defaultDateTo ||
    maxProfitPct !== undefined;
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
  const currentShopId = useShopStore((s) => s.currentShopId);
  const allShopsMode = isAllShops(currentShopId);

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
    // Shop column — only shown in "All Shops" mode so users can tell
    // which GST entity each row came from. In single-shop mode this is
    // implicit from the header badge so omitting it keeps the table tight.
    ...(allShopsMode
      ? ([
          {
            key: 'shop' as keyof SaleListItem,
            header: 'Shop',
            sortable: true,
            sortAccessor: (row: SaleListItem) => row.shop?.code ?? '',
            render: (row: SaleListItem) =>
              row.shop ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                  {row.shop.code}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
            className: 'w-20',
          },
        ] as Column<SaleListItem>[])
      : []),
    {
      key: 'saleNumber',
      header: 'Sale #',
      sortable: true,
      sortAccessor: (row) => row.saleNumber,
      render: (row) => (
        can('sales.detail') ? (
          <button
            onClick={() => navigate(`/sales/${row.id}`)}
            className="font-mono text-xs font-medium text-primary hover:underline text-left"
          >
            {row.saleNumber}
          </button>
        ) : (
          <span className="font-mono text-xs font-medium text-left">{row.saleNumber}</span>
        )
      ),
    },
    {
      key: 'ledgerNumber',
      header: 'Ledger #',
      sortable: true,
      sortAccessor: (row) => row.ledgerNumber,
      render: (row) => (
        <span className="font-mono text-xs">{row.ledgerNumber}</span>
      ),
    },
    {
      key: 'saleDate',
      header: 'Date',
      sortable: true,
      sortAccessor: (row) => new Date(row.saleDate),
      render: (row) => formatDateIN(row.saleDate),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      sortAccessor: (row) => {
        const c = (row as any).customer;
        return c?.name || row.customerName || '';
      },
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
      sortable: true,
      sortAccessor: (row) => {
        const p = (row as any).product;
        return `${p?.brand || row.productBrand || ''} ${p?.modelNumber || row.productModel || ''}`.trim();
      },
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
      sortable: true,
      sortAccessor: (row) => row.saleType,
      render: (row) => <StatusBadge status={row.saleType} />,
    },
    {
      key: 'totalAmount',
      header: 'Total',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => Number(row.totalAmount) || 0,
      render: (row) => (
        <span className="font-medium">{formatINR(row.totalAmount)}</span>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      sortable: true,
      sortAccessor: (row) => getPaymentStatus(row),
      render: (row) => <StatusBadge status={getPaymentStatus(row)} />,
    },
    {
      key: 'completion',
      header: 'Status',
      sortable: true,
      sortAccessor: (row) => (row.completedAt ? 1 : 0),
      render: (row) => <CompletionBadge completedAt={row.completedAt} />,
    },
    {
      key: 'createdBy',
      header: 'Created By',
      sortable: true,
      sortAccessor: (row) => {
        const creator = (row as any).creator;
        return creator?.fullName || creator?.username || '';
      },
      render: (row) => {
        const creator = (row as any).creator;
        return (
          <span className="text-xs text-muted-foreground">{creator?.fullName || creator?.username || '-'}</span>
        );
      },
    },
    // Invoice download — only if user has invoice permission
    ...(can('sales.invoice.download_pdf') ? [{
      key: 'actions' as keyof SaleListItem,
      header: '',
      className: 'w-10',
      render: (row: SaleListItem) => (
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
    }] : []),
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
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold">Sales</h1>
        <button
          onClick={() => navigate('/sales/scan-register')}
          className={cn(
            'flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium',
            'hover:bg-muted transition-colors',
          )}
        >
          <ScanLine className="h-4 w-4" />
          Scan Register Page
        </button>
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
        {/* Customer / product search */}
        <div className="min-w-[240px] flex-1 max-w-sm">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => {
                updateFilters({ customerSearch: e.target.value, page: '1' });
              }}
              placeholder="Ledger #, name, phone, model, or serial (min 2 chars)..."
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
            disabled={isSearching}
            onChange={(e) => {
              updateFilters({ dateFrom: e.target.value, page: '1' });
            }}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
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
            disabled={isSearching}
            max={defaultDateTo}
            onChange={(e) => {
              updateFilters({ dateTo: e.target.value, page: '1' });
            }}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />
        </div>

        {/* Net-profit % filter (only if user can see profit) */}
        {canSeeProfit && (
          <div className="min-w-[170px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Net Profit %
            </label>
            <div className="relative">
              <select
                value={maxProfitPctRaw}
                onChange={(e) => {
                  updateFilters({ maxProfitPct: e.target.value, page: '1' });
                }}
                className={cn(
                  'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="">All</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20].map((t) => (
                  <option key={t} value={t}>
                    ≤ {t}%
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        )}

        <button
          onClick={() => {
            const { dateFrom: fyStart, dateTo: fyEnd } = getCurrentFinancialYearRange();
            updateFilters({ dateFrom: fyStart, dateTo: fyEnd, customerSearch: '', page: '1' });
          }}
          className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Current Financial Year
        </button>

        <button
          onClick={() => {
            const { dateFrom: fyStart, dateTo: fyEnd } = getLastFinancialYearRange();
            updateFilters({ dateFrom: fyStart, dateTo: fyEnd, customerSearch: '', page: '1' });
          }}
          className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Last Financial Year
        </button>

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
