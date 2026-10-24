import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useCanCheck } from '../../hooks/usePermission';
import {
  Plus,
  ChevronDown,
  
  X,
  ArrowRightLeft,
  Inbox,
  Loader2,
  CheckCircle } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import {
  useTransfersQuery,
  useIncomingTransfersQuery,
  useReceiveTransferMutation,
} from '../../hooks/useTransfers';
import type { Transfer } from '../../hooks/useTransfers';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { DateInput } from '../../components/DateInput';
import { StatusBadge } from '../../components/StatusBadge';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { formatINR, formatDateIN, getCurrentFinancialYearRange, getLastFinancialYearRange } from '@retailerp/shared-utils';

const PAGE_SIZE = 20;

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

type Tab = 'all' | 'incoming';

export function TransferListPage() {
  const navigate = useNavigate();
  const can = useCanCheck();

  // ------ Filters state (URL search params) ------
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get('tab') as Tab) || 'all';
  const page = Number(searchParams.get('page')) || 1;
  const status = searchParams.get('status') || '';
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

  // All transfers query
  const transfersQuery = useTransfersQuery({
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  // Incoming transfers query
  const incomingQuery = useIncomingTransfersQuery();

  const transfers = transfersQuery.data?.data ?? [];
  const pagination = transfersQuery.data?.pagination;
  const incomingTransfers = incomingQuery.data ?? [];

  // ------ Clear filters ------
  const hasFilters = status || dateFrom !== getDateDaysAgo(90) || dateTo !== getToday();
  const clearFilters = () => {
    // Keep the current tab when clearing filters
    setSearchParams(activeTab !== 'all' ? { tab: activeTab } : {}, { replace: true });
  };

  // ------ Receive mutation (for incoming tab) ------
  const receiveMutation = useReceiveTransferMutation();
  const [confirmReceiveId, setConfirmReceiveId] = useState<string | null>(null);

  useEscapeKey(!!confirmReceiveId, () => setConfirmReceiveId(null));

  const handleReceive = (id: string) => {
    receiveMutation.mutate(id, {
      onSuccess: () => {
        setConfirmReceiveId(null);
      },
    });
  };

  // ------ Table columns (All Transfers) ------
  const allColumns: Column<Transfer>[] = [
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
      key: 'id',
      header: 'Transfer #',
      render: (row) => (
        <button
          onClick={() => navigate(`/transfers/${row.id}`)}
          className="font-mono text-xs text-primary hover:underline text-left"
        >
          {row.id.slice(0, 8).toUpperCase()}
        </button>
      ),
    },
    {
      key: 'product',
      // The long text on this row, so spare width lands where it reads.
      flexible: true,
      header: 'Product',
      render: (row) => (
        <span className="font-medium">
          {row.product
            ? `${row.product.brand} ${row.product.modelNumber}`
            : '-'}
        </span>
      ),
    },
    {
      key: 'fromShop',
      header: 'From Shop',
      render: (row) =>
        row.fromShop
          ? `${row.fromShop.name} (${row.fromShop.code})`
          : '-',
    },
    {
      key: 'toShop',
      header: 'To Shop',
      render: (row) =>
        row.toShop
          ? `${row.toShop.name} (${row.toShop.code})`
          : '-',
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => formatDateIN(row.createdAt),
    },
    {
      key: 'transferPrice',
      header: 'Transfer Price',
      align: 'right',
      render: (row) =>
        row.transferPrice != null ? formatINR(row.transferPrice) : '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      // The only way to act on a row; hiding it would strand the row.
      alwaysVisible: true,
      exportable: false,
      resizable: false,
      header: '',
      render: (row) => (
        <button
          onClick={() => navigate(`/transfers/${row.id}`)}
          className="text-xs text-primary hover:underline"
        >
          View
        </button>
      ),
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
        title="Transfers"
        description="Stock moving between shops — each transfer is a sale from one GST entity to another."
        actions={
          can('transfers.initiate') && (
            <Link to="/transfers/new">
              <Button icon={<Plus className="h-3.5 w-3.5" />}>New transfer</Button>
            </Link>
          )
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6">
        <button
          onClick={() => updateFilters({ tab: '', page: '1', status: '', dateFrom: '', dateTo: '' })}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowRightLeft className="h-4 w-4" />
          All Transfers
        </button>
        <button
          onClick={() => updateFilters({ tab: 'incoming', page: '1', status: '', dateFrom: '', dateTo: '' })}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'incoming'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Inbox className="h-4 w-4" />
          Incoming
          {incomingTransfers.length > 0 && (
            <span className="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
              {incomingTransfers.length}
            </span>
          )}
        </button>
      </div>

      {/* ============================== ALL TRANSFERS TAB ============================== */}
      {activeTab === 'all' && (
        <>
          {/* Filters row */}
          <div className="flex flex-wrap items-end gap-4 mb-6">
            {/* Status dropdown */}
            <div className="min-w-[160px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Status
              </label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => {
                    updateFilters({ status: e.target.value, page: '1' });
                  }}
                  className={cn(
                    'w-full appearance-none rounded-md border bg-field px-3 py-2 pr-8 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                >
                  <option value="">All</option>
                  <option value="initiated">Initiated</option>
                  <option value="in_transit">In Transit</option>
                  <option value="received">Received</option>
                  <option value="cancelled">Cancelled</option>
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

            {/* Quick FY filters */}
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
          {transfersQuery.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
              Failed to load transfers. Please try again.
            </div>
          )}

          {/* Data table */}
          <DataTable<Transfer>
            tableId="transfers"
            exportConfig={{ title: 'Transfers' }}
            columns={allColumns}
            data={transfers}
            isLoading={transfersQuery.isLoading}
            pagination={paginationState}
            onPageChange={(p) => updateFilters({ page: String(p) })}
            emptyMessage="No transfers found matching your filters."
            rowKey={(row) => row.id}
          />
        </>
      )}

      {/* ============================== INCOMING TAB ============================== */}
      {activeTab === 'incoming' && (
        <>
          {/* Error state */}
          {incomingQuery.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
              Failed to load incoming transfers. Please try again.
            </div>
          )}

          {/* Loading */}
          {incomingQuery.isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* Empty state */}
          {!incomingQuery.isLoading && incomingTransfers.length === 0 && (
            <div className="rounded-lg border bg-card p-12 text-center">
              <Inbox className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-1">No incoming transfers</h3>
              <p className="text-sm text-muted-foreground">
                There are no pending transfers waiting to be received at your shop.
              </p>
            </div>
          )}

          {/* Incoming transfer cards */}
          {!incomingQuery.isLoading && incomingTransfers.length > 0 && (
            <div className="space-y-4">
              {incomingTransfers.map((transfer) => (
                <div
                  key={transfer.id}
                  className="rounded-lg border bg-card p-5 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <button
                          onClick={() => navigate(`/transfers/${transfer.id}`)}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          #{transfer.id.slice(0, 8).toUpperCase()}
                        </button>
                        <StatusBadge status={transfer.status} />
                      </div>
                      <p className="font-medium text-lg">
                        {transfer.product
                          ? `${transfer.product.brand} ${transfer.product.modelNumber}`
                          : 'Unknown Product'}
                      </p>
                      {transfer.product?.serialNumber && (
                        <p className="text-sm text-muted-foreground font-mono mt-0.5">
                          SN: {transfer.product.serialNumber}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                        <span>
                          From:{' '}
                          <span className="font-medium text-foreground">
                            {transfer.fromShop
                              ? `${transfer.fromShop.name} (${transfer.fromShop.code})`
                              : '-'}
                          </span>
                        </span>
                        <span>{formatDateIN(transfer.createdAt)}</span>
                        {transfer.transferPrice != null && (
                          <span>
                            Transfer Price:{' '}
                            <span className="font-medium text-foreground">
                              {formatINR(transfer.transferPrice)}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {can('transfers.receive') && (
                        <button
                          onClick={() => setConfirmReceiveId(transfer.id)}
                          disabled={receiveMutation.isPending}
                          className={cn(
                            'flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                            'hover:bg-primary-hover transition-colors',
                            'disabled:opacity-50 disabled:cursor-not-allowed',
                          )}
                        >
                          <CheckCircle className="h-4 w-4" />
                          Receive
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/transfers/${transfer.id}`)}
                        className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        View
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ============================== CONFIRM RECEIVE DIALOG ============================== */}
      {confirmReceiveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setConfirmReceiveId(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-6 shadow-xl mx-4">
            <h3 className="text-lg font-medium mb-2">Confirm Receipt</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to mark this transfer as received? This will
              add the product to your shop&apos;s inventory.
            </p>

            {receiveMutation.error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
                {(receiveMutation.error as any)?.response?.data?.error ??
                  'Something went wrong. Please try again.'}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => handleReceive(confirmReceiveId)}
                disabled={receiveMutation.isPending}
                className={cn(
                  'flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                  'hover:bg-primary-hover transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {receiveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Receiving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Confirm Receive
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReceiveId(null)}
                className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
