import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {    Download, Loader2, ScanLine, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { useSalesQuery, usePendingApprovalCountQuery, useApproveSaleMutation } from '../../hooks/useSales';
import type { SaleListItem } from '../../hooks/useSales';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar, FilterField } from '../../components/FilterBar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Tabs } from '../../components/ui/tabs';
import { StatusBadge } from '../../components/StatusBadge';
import { CompletionBadge } from '../../components/CompletionBadge';
import { formatINR, formatDateIN, getCurrentFinancialYearRange, getLastFinancialYearRange } from '@retailerp/shared-utils';
import { SaleType } from '@retailerp/shared-types';
import { handleInvoiceDownload } from '../../lib/invoice-utils';
import { InvoiceConfirmDialog } from '../../components/InvoiceConfirmDialog';
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
  const [downloadingId] = useState<string | null>(null);
  const can = useCanCheck();
  const canApprove = can('sales.approve');

  // ------ Filters state (URL search params) ------
  const page = Number(searchParams.get('page')) || 1;
  const customerSearch = searchParams.get('customerSearch') || '';
  const debouncedCustomerSearch = useDebounce(customerSearch, 300);
  const saleType = searchParams.get('saleType') || '';
  // Approval filter — when 'pending' the list is restricted to sales
  // awaiting approval (the list view used by the "Approve" button).
  const approvalFilterRaw = searchParams.get('approvalStatus') || '';
  const approvalFilter: 'pending' | 'approved' | undefined =
    approvalFilterRaw === 'pending' || approvalFilterRaw === 'approved'
      ? (approvalFilterRaw as 'pending' | 'approved')
      : undefined;
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
    approvalStatus: approvalFilter,
  });

  const sales = salesQuery.data?.data ?? [];
  const pagination = salesQuery.data?.pagination;

  // Pending-approval count for the badge subscript on the "Approve" button.
  // Only fetched if the user can approve (otherwise the button is hidden).
  const pendingCountQuery = usePendingApprovalCountQuery(canApprove);
  const pendingCount = pendingCountQuery.data ?? 0;
  const approveMutation = useApproveSaleMutation();

  // ------ Clear filters ------
  const hasFilters =
    !!customerSearch ||
    !!saleType ||
    dateFrom !== defaultDateFrom ||
    dateTo !== defaultDateTo ||
    maxProfitPct !== undefined ||
    !!approvalFilter;
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  // Which financial-year preset the current date range corresponds to. Drives
  // the segmented control; `custom` only appears once the user has picked an
  // arbitrary range, so the control never shows a phantom third option.
  const currentFyRange = getCurrentFinancialYearRange();
  const lastFyRange = getLastFinancialYearRange();
  const fyPreset: 'current' | 'last' | 'custom' =
    dateFrom === currentFyRange.dateFrom && dateTo === currentFyRange.dateTo
      ? 'current'
      : dateFrom === lastFyRange.dateFrom && dateTo === lastFyRange.dateTo
        ? 'last'
        : 'custom';

  // Search is shown separately in the toolbar, so it isn't counted here —
  // the badge is about filters hidden behind the disclosure.
  const activeFilterCount = [
    !!saleType,
    dateFrom !== defaultDateFrom || dateTo !== defaultDateTo,
    maxProfitPct !== undefined,
    !!approvalFilter,
  ].filter(Boolean).length;

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
  // Opens the confirm-and-edit dialog so the user can verify shop +
  // (B2B) customer details before the PDF is generated. The legacy
  // direct-download helper is retained for reference and is also used
  // by the dialog under the hood.
  void handleInvoiceDownload;
  const [invoiceTargetId, setInvoiceTargetId] = useState<string | null>(null);
  const onDownloadInvoice = (saleId: string) => {
    void downloadingId;
    setInvoiceTargetId(saleId);
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
            className="whitespace-nowrap text-left font-mono text-xs font-medium text-primary hover:underline"
          >
            {row.saleNumber}
          </button>
        ) : (
          <span className="whitespace-nowrap font-mono text-xs font-medium">{row.saleNumber}</span>
        )
      ),
    },
    {
      key: 'ledgerNumber',
      header: 'Ledger #',
      sortable: true,
      sortAccessor: (row) => row.ledgerNumber,
      render: (row) => (
        <span className="whitespace-nowrap font-mono text-xs">{row.ledgerNumber}</span>
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
            <p className="max-w-[11rem] truncate text-sm font-medium">{c?.name || row.customerName || "-"}</p>
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
          <span className="block max-w-[9rem] truncate text-xs text-muted-foreground" title={creator?.fullName || creator?.username || undefined}>{creator?.fullName || creator?.username || "-"}</span>
        );
      },
    },
    // Approval status — shown as a small badge. Approvers (who have
    // `sales.approve`) get an inline "Approve" button on pending rows so
    // they can clear them without opening the detail page.
    {
      key: 'approvalStatus' as keyof SaleListItem,
      header: 'Approval',
      sortable: true,
      sortAccessor: (row) => row.approvalStatus ?? 'approved',
      render: (row) => {
        const status = row.approvalStatus ?? 'approved';
        if (status === 'pending') {
          return (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Pending
              </span>
              {canApprove && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    approveMutation.mutate(row.id);
                  }}
                  disabled={approveMutation.isPending}
                  title="Approve this sale"
                  className={cn(
                    'flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground',
                    'hover:bg-primary-hover transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve
                </button>
              )}
            </div>
          );
        }
        return (
          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
            Approved
          </span>
        );
      },
    },
    // Invoice download — only if user has invoice permission
    ...(can('sales.invoice.download_pdf') ? [{
      key: 'actions' as keyof SaleListItem,
      // The only way to act on a row; hiding it would strand the row.
      alwaysVisible: true,
      resizable: false,
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
      <PageHeader
        title="Sales"
        description="Every recorded sale across full-payment, installment and finance-company deals."
        actions={
          <>
            {/*
             * Approval is a review queue, not a filter. It used to sit in the
             * filter strip between two financial-year buttons, which made a
             * state-changing workflow look like a harmless view toggle.
             */}
            {canApprove && (
              <Button
                variant={approvalFilter === 'pending' ? 'secondary' : 'outline'}
                onClick={() =>
                  updateFilters({
                    approvalStatus: approvalFilter === 'pending' ? '' : 'pending',
                    page: '1',
                  })
                }
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                title="Show sales pending approval"
              >
                Pending approval
                {pendingCount > 0 && (
                  <span className="tabular ml-0.5 rounded bg-warning px-1.5 text-[0.6875rem] font-semibold text-warning-foreground">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => navigate('/sales/scan-register')}
              icon={<ScanLine className="h-3.5 w-3.5" />}
            >
              Scan register
            </Button>
          </>
        }
      />

      <FilterBar
        search={customerSearch}
        onSearchChange={(value) => updateFilters({ customerSearch: value, page: '1' })}
        searchPlaceholder="Ledger #, name, phone, model or serial (min 2 chars)…"
        activeCount={activeFilterCount}
        onClear={hasFilters ? clearFilters : undefined}
        trailing={
          <Tabs
            aria-label="Date range preset"
            value={fyPreset}
            onChange={(value) => {
              if (value === 'custom') return;
              const range =
                value === 'current'
                  ? getCurrentFinancialYearRange()
                  : getLastFinancialYearRange();
              updateFilters({
                dateFrom: range.dateFrom,
                dateTo: range.dateTo,
                customerSearch: '',
                page: '1',
              });
            }}
            items={[
              { value: 'current', label: 'This FY' },
              { value: 'last', label: 'Last FY' },
              ...(fyPreset === 'custom'
                ? [{ value: 'custom' as const, label: 'Custom' }]
                : []),
            ]}
          />
        }
        advanced={
          <>
            <FilterField label="From">
              <Input
                type="date"
                value={dateFrom}
                disabled={isSearching}
                onChange={(e) => updateFilters({ dateFrom: e.target.value, page: '1' })}
              />
            </FilterField>
            <FilterField label="To">
              <Input
                type="date"
                value={dateTo}
                disabled={isSearching}
                max={defaultDateTo}
                onChange={(e) => updateFilters({ dateTo: e.target.value, page: '1' })}
              />
            </FilterField>
            {canSeeProfit && (
              <FilterField label="Net profit %">
                <Select
                  value={maxProfitPctRaw}
                  onChange={(e) => updateFilters({ maxProfitPct: e.target.value, page: '1' })}
                >
                  <option value="">All</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20].map((t) => (
                    <option key={t} value={t}>
                      ≤ {t}%
                    </option>
                  ))}
                </Select>
              </FilterField>
            )}
          </>
        }
      >
        <FilterField label="Sale type">
          <Select
            value={saleType}
            onChange={(e) => updateFilters({ saleType: e.target.value, page: '1' })}
          >
            {SALE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {/* Error state */}
      {salesQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load sales. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<SaleListItem>
        tableId="sales"
        columns={columns}
        data={sales}
        isLoading={salesQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No sales found matching your filters."
        rowKey={(row) => row.id}
      />

      {invoiceTargetId && (
        <InvoiceConfirmDialog
          saleId={invoiceTargetId}
          onClose={() => setInvoiceTargetId(null)}
        />
      )}
    </div>
  );
}
