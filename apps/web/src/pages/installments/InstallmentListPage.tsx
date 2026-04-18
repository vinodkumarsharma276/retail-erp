import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  CalendarDays,
  Eye,
  Banknote,
  Calendar,
  Search,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { DataTable, type Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import {
  useOverdueInstallmentsQuery,
  useCollectionsRangeQuery,
  useInstallmentSearchQuery,
  type OverdueInstallmentItem,
  type CollectionItem,
} from '../../hooks/useInstallments';
import { useDebounce } from '../../hooks/useDebounce';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { formatInstallmentLabel } from '../../lib/installment-label';

// ---------------------------------------------------------------------------
// Search filter options
// ---------------------------------------------------------------------------
const SEARCH_FILTERS = [
  { value: 'ledger_number', label: 'Ledger #' },
  { value: 'sale_number', label: 'Sale Number' },
  { value: 'customer_phone', label: 'Customer Phone' },
  { value: 'customer_name', label: 'Customer Name' },
  { value: 'all', label: 'All' },
];

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
type TabKey = 'collections' | 'overdue' | 'search';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'collections', label: "Today's Scheduled" },
  { key: 'overdue', label: 'All Overdue' },
  { key: 'search', label: 'Search Installment' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function InstallmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get('tab') as TabKey) || 'collections';

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState('ledger_number');
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Search results query
  const { data: searchResults, isLoading: isSearching } = useInstallmentSearchQuery(debouncedSearch, searchFilter);

  // Payment dialog state for search results
  const [searchPaymentTarget, setSearchPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
    dueDate?: string;
  } | null>(null);

  // Expanded search result cards (collapsed by default)
  const [expandedScheduleIds, setExpandedScheduleIds] = useState<Set<string>>(new Set());
  const toggleScheduleExpanded = (id: string) => {
    setExpandedScheduleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const setActiveTab = (tab: TabKey) => {
    // Reset page when switching tabs
    updateFilters({ tab: tab === 'collections' ? '' : tab, page: '' });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Installments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage installment schedules, track overdue payments, and record collections.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 rounded-lg bg-muted p-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex-shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search tab content */}
      {activeTab === 'search' && (
        <>
          <div className="rounded-lg border bg-card p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              {/* Filter dropdown */}
              <div className="relative">
                <select
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className={cn(
                    'appearance-none rounded-md border bg-background pl-3 pr-8 py-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                >
                  {SEARCH_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>

              {/* Search input */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search installments..."
                  className={cn(
                    'w-full rounded-md border bg-background pl-9 pr-9 py-2 text-sm',
                    'placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  )}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Loading indicator */}
              {isSearching && (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Search results */}
          {searchResults && searchResults.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
                <p>
                  {searchResults.length} result{searchResults.length === 1 ? '' : 's'} found
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedScheduleIds(new Set(searchResults.map((s: any) => s.id)))
                    }
                    className="text-xs text-primary hover:underline"
                  >
                    Expand all
                  </button>
                  <span>|</span>
                  <button
                    type="button"
                    onClick={() => setExpandedScheduleIds(new Set())}
                    className="text-xs text-primary hover:underline"
                  >
                    Collapse all
                  </button>
                </div>
              </div>

              <div className="mb-6 space-y-2">
                {searchResults.map((schedule: any) => {
                  const isExpanded = expandedScheduleIds.has(schedule.id);
                  const pendingCount = schedule.installments.filter(
                    (i: any) => Number(i.remainingAmount) > 0,
                  ).length;
                  return (
                    <div key={schedule.id} className="rounded-lg border bg-card">
                      {/* Collapsible header */}
                      <button
                        type="button"
                        onClick={() => toggleScheduleExpanded(schedule.id)}
                        className={cn(
                          'flex w-full items-center gap-3 p-3 text-left transition-colors',
                          'hover:bg-muted/50',
                          isExpanded && 'border-b',
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform',
                            isExpanded && 'rotate-90',
                          )}
                        />
                        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{schedule.sale.customer.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {schedule.sale.customer.phone} | {schedule.sale.product.brand} {schedule.sale.product.modelNumber}
                            </p>
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            Ledger: <span className="font-medium text-foreground">{schedule.sale.ledgerNumber}</span>
                            {' '}| Sale: <span className="font-medium text-foreground">{schedule.sale.saleNumber}</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-medium whitespace-nowrap">
                            {formatINR(schedule.emiAmount)}/mo
                          </p>
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            {pendingCount} pending / {schedule.numInstallments}
                          </p>
                        </div>
                      </button>

                      {/* Collapsible body */}
                      {isExpanded && (
                        <div className="p-4">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left">
                                  <th className="pb-2 text-xs font-medium text-muted-foreground">EMI #</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground">Due Date</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Amount</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Paid</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Remaining</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground">Status</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {schedule.installments.map((inst: any) => (
                                  <tr key={inst.id}>
                                    <td className="py-2">{formatInstallmentLabel(inst)}</td>
                                    <td className="py-2">{formatDateIN(inst.dueDate)}</td>
                                    <td className="py-2 text-right">{formatINR(inst.amountDue)}</td>
                                    <td className="py-2 text-right text-green-600">{formatINR(inst.amountPaid)}</td>
                                    <td className="py-2 text-right text-red-600">{formatINR(inst.remainingAmount)}</td>
                                    <td className="py-2"><StatusBadge status={inst.status} /></td>
                                    <td className="py-2">
                                      {Number(inst.remainingAmount) > 0 && inst.status !== 'rescheduled' && inst.status !== 'partially_paid' && (
                                        <button
                                          onClick={() =>
                                            setSearchPaymentTarget({
                                              id: inst.id,
                                              amount: Number(inst.remainingAmount),
                                              number: inst.installmentNumber,
                                              dueDate: typeof inst.dueDate === 'string' ? inst.dueDate.split('T')[0] : new Date(inst.dueDate).toISOString().split('T')[0],
                                            })
                                          }
                                          className={cn(
                                            'flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white',
                                            'hover:bg-green-700 transition-colors',
                                          )}
                                        >
                                          <Banknote className="h-3.5 w-3.5" />
                                          Pay
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* No results message */}
          {debouncedSearch.trim().length >= 2 && !isSearching && searchResults && searchResults.length === 0 && (
            <div className="mb-6 rounded-lg border bg-card py-6 flex items-center justify-center text-muted-foreground">
              <p className="text-sm">No results found for &ldquo;{debouncedSearch}&rdquo;</p>
            </div>
          )}

          {/* Hint when input is empty */}
          {debouncedSearch.trim().length < 2 && (
            <div className="mb-6 rounded-lg border border-dashed bg-card/50 py-10 flex items-center justify-center text-muted-foreground">
              <p className="text-sm">Type at least 2 characters to search installments.</p>
            </div>
          )}
        </>
      )}

      {/* Tab content */}
      {activeTab === 'collections' && <CollectionsTab />}
      {activeTab === 'overdue' && <OverdueTab />}

      {/* Payment dialog for search results */}
      {searchPaymentTarget && (
        <RecordPaymentDialog
          installmentId={searchPaymentTarget.id}
          amountDue={searchPaymentTarget.amount}
          installmentNumber={searchPaymentTarget.number}
          defaultDate={searchPaymentTarget.dueDate}
          onSuccess={() => setSearchPaymentTarget(null)}
          onClose={() => setSearchPaymentTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overdue Tab
// ---------------------------------------------------------------------------
function OverdueTab() {
  const navigate = useNavigate();
  const { data: overdueItems, isLoading, isError } = useOverdueInstallmentsQuery();

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
  } | null>(null);

  const columns: Column<OverdueInstallmentItem>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <div>
            <p className="font-medium">{row.customerName}</p>
            <p className="text-xs text-muted-foreground">{row.customerPhone}</p>
          </div>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        render: (row) => (
          <span className="text-sm">{row.productBrand} {row.productName}</span>
        ),
      },
      {
        key: 'emiNumber',
        header: 'EMI #',
        render: (row) => (
          <span className="text-sm font-medium">{formatInstallmentLabel(row)}</span>
        ),
      },
      {
        key: 'amountDue',
        header: 'Amount Due',
        align: 'right' as const,
        render: (row) => (
          <span className="font-semibold text-red-600">
            {formatINR(row.remainingAmount)}
          </span>
        ),
      },
      {
        key: 'dueDate',
        header: 'Due Date',
        render: (row) => (
          <span className="text-sm">{formatDateIN(row.dueDate)}</span>
        ),
      },
      {
        key: 'daysOverdue',
        header: 'Days Overdue',
        align: 'right' as const,
        render: (row) => (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
              row.daysOverdue > 30
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : row.daysOverdue > 7
                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
            )}
          >
            {row.daysOverdue}d
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPaymentTarget({
                  id: row.id,
                  amount: row.remainingAmount,
                  number: row.installmentNumber,
                });
              }}
              className={cn(
                'flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white',
                'hover:bg-green-700 transition-colors',
              )}
            >
              <Banknote className="h-3.5 w-3.5" />
              Pay
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/installments/${row.scheduleId}`);
              }}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                'hover:bg-muted transition-colors',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              View
            </button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="h-8 w-8 text-destructive mb-2" />
        <p className="text-sm text-muted-foreground">Failed to load overdue installments</p>
      </div>
    );
  }

  return (
    <>
      <DataTable<OverdueInstallmentItem>
        columns={columns}
        data={overdueItems ?? []}
        isLoading={isLoading}
        emptyMessage="No overdue installments. Great job!"
        rowKey={(row) => row.id}
      />

      {paymentTarget && (
        <RecordPaymentDialog
          installmentId={paymentTarget.id}
          amountDue={paymentTarget.amount}
          installmentNumber={paymentTarget.number}
          onSuccess={() => setPaymentTarget(null)}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Today's Scheduled Tab (date range)
// ---------------------------------------------------------------------------
function getDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
}

function CollectionsTab() {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const { data: rangeData, isLoading, isError } = useCollectionsRangeQuery(dateFrom, dateTo);
  const collections = rangeData?.collections ?? [];

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
  } | null>(null);

  const isTodayOnly = dateFrom === today && dateTo === today;

  const collectionColumns: Column<CollectionItem>[] = useMemo(
    () => [
      {
        key: 'dueDate',
        header: 'Due Date',
        render: (row) => {
          const dateStr = typeof row.dueDate === 'string'
            ? row.dueDate.split('T')[0]
            : new Date(row.dueDate).toISOString().split('T')[0];
          const isOverdue = dateStr < today;
          return (
            <div className="flex items-center gap-2">
              <span className="text-sm">{formatDateIN(row.dueDate)}</span>
              {isOverdue && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {row.daysOverdue}d
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <div>
            <p className="font-medium">{row.customerName}</p>
            <p className="text-xs text-muted-foreground">{row.customerPhone}</p>
          </div>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        render: (row) => (
          <span className="text-sm">{row.productBrand} {row.productName}</span>
        ),
      },
      {
        key: 'emiNumber',
        header: 'EMI #',
        render: (row) => (
          <span className="text-sm font-medium">
            {formatInstallmentLabel(row)} of {row.totalInstallments}
          </span>
        ),
      },
      {
        key: 'amountDue',
        header: 'Amount Due',
        align: 'right' as const,
        render: (row) => (
          <span className="font-semibold">{formatINR(row.remainingAmount)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPaymentTarget({
                  id: row.id,
                  amount: Number(row.remainingAmount),
                  number: row.installmentNumber,
                });
              }}
              className={cn(
                'flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white',
                'hover:bg-green-700 transition-colors',
              )}
            >
              <Banknote className="h-3.5 w-3.5" />
              Pay
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/sales/${row.saleId}`);
              }}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                'hover:bg-muted transition-colors',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              View
            </button>
          </div>
        ),
      },
    ],
    [navigate, today],
  );

  return (
    <div>
      {/* Date range picker */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium">From:</label>
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className={cn(
            'rounded-md border bg-background px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          )}
        />
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">To:</label>
        </div>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className={cn(
            'rounded-md border bg-background px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          )}
        />
        <div className="flex items-center gap-2">
          {!isTodayOnly && (
            <button
              onClick={() => { setDateFrom(today); setDateTo(today); }}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Today
            </button>
          )}
          <button
            onClick={() => { setDateFrom(getDateDaysAgo(7)); setDateTo(today); }}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Last 7 Days
          </button>
          <button
            onClick={() => { setDateFrom(getDateDaysAgo(14)); setDateTo(today); }}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Last 2 Weeks
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">
            Failed to load collections
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && collections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CalendarDays className="h-12 w-12 mb-3 opacity-50" />
          <p className="text-lg font-medium">
            {isTodayOnly ? 'No collections due today' : 'No collections for this period'}
          </p>
          <p className="text-sm mt-1">
            {isTodayOnly
              ? 'All installments for today are either paid or none are scheduled.'
              : `No pending installments between ${formatDateIN(dateFrom)} and ${formatDateIN(dateTo)}.`}
          </p>
          {isTodayOnly && (
            <button
              onClick={() => { setDateFrom(getDateDaysAgo(14)); setDateTo(today); }}
              className="mt-4 rounded-md border px-4 py-2 text-sm font-medium text-primary hover:bg-muted transition-colors"
            >
              Check last 2 weeks instead
            </button>
          )}
        </div>
      )}

      {/* Collection table */}
      {!isLoading && !isError && collections.length > 0 && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="rounded-lg border bg-card p-4 flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Total Collections
              </p>
              <p className="text-lg font-semibold">{collections.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Total Amount Due
              </p>
              <p className="text-lg font-semibold">
                {formatINR(
                  collections.reduce((sum: number, c: CollectionItem) => sum + Number(c.remainingAmount), 0),
                )}
              </p>
            </div>
          </div>

          {/* Table */}
          <DataTable<CollectionItem>
            columns={collectionColumns}
            data={collections}
            isLoading={false}
            emptyMessage=""
            rowKey={(row) => row.id}
          />
        </div>
      )}

      {/* Payment dialog */}
      {paymentTarget && (
        <RecordPaymentDialog
          installmentId={paymentTarget.id}
          amountDue={paymentTarget.amount}
          installmentNumber={paymentTarget.number}
          onSuccess={() => setPaymentTarget(null)}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}

