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
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/ui/tabs';
import { DataTable, type Column } from '../../components/DataTable';
import { DateInput } from '../../components/DateInput';
import { StatusBadge } from '../../components/StatusBadge';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import { CallListTab } from './CallListTab';
import {
  useOverdueInstallmentsQuery,
  useCollectionsRangeQuery,
  useInstallmentSearchQuery,
  usePaidCollectionsRangeQuery,
  type OverdueInstallmentItem,
  type CollectionItem,
  type PaidCollectionItem,
} from '../../hooks/useInstallments';
import { useDebounce } from '../../hooks/useDebounce';
import { formatINR, formatDateIN, getCurrentFinancialYearRange, getLastFinancialYearRange } from '@retailerp/shared-utils';
import { formatInstallmentLabel } from '../../lib/installment-label';
import { useShopStore, isAllShops } from '../../stores/shop-store';
import { usePermission } from '../../hooks/usePermission';

const ZONE_OPTIONS = ['East', 'West', 'North', 'South', 'Delhi', 'Ghaziabad', 'Noida'] as const;

/**
 * Inline Zone <select> shared by the 3 installment tabs. Only renders when
 * the caller has the `view.customer.address.zone` permission. The empty
 * value means "all zones" — no filter applied.
 */
function ZoneFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium">Zone:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'appearance-none rounded-md border bg-field px-3 py-2 pr-8 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        )}
      >
        <option value="">All Zones</option>
        {ZONE_OPTIONS.map((z) => (
          <option key={z} value={z}>{z}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Compact "Total Due" chip shown beside the filter controls on every
 * installment tab. Same look across tabs so users instantly recognize it.
 * Use `count` to show "(n items)" subscript; pass `label` to override the
 * leading text (e.g. "Total Collected" on the Paid tab).
 */
function TotalDueChip({
  amount,
  count,
  label = 'Total Due',
  variant = 'red',
}: {
  amount: number;
  count?: number;
  label?: string;
  variant?: 'red' | 'amber' | 'green';
}) {
  // Semantic tokens rather than raw palette steps, so the chip follows the
  // theme and stays legible in dark mode without a second set of classes.
  const palette =
    variant === 'green'
      ? 'border-success/30 bg-success-muted text-success'
      : variant === 'amber'
        ? 'border-warning/30 bg-warning-muted text-warning'
        : 'border-destructive/30 bg-destructive-muted text-destructive';
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-3 py-1.5',
        palette,
      )}
      title={`${label}${count !== undefined ? ` across ${count} item${count === 1 ? '' : 's'}` : ''}`}
    >
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </span>
      <span className="tabular text-sm font-semibold">{formatINR(amount)}</span>
      {count !== undefined && (
        <span className="text-xs opacity-75">
          ({count} item{count === 1 ? '' : 's'})
        </span>
      )}
    </div>
  );
}

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
type TabKey = 'calls' | 'collections' | 'overdue' | 'paid' | 'search';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'calls', label: "Today's Calls" },
  { key: 'collections', label: 'Scheduled' },
  { key: 'overdue', label: 'All Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'search', label: 'Search Installment' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function InstallmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const activeTab = (searchParams.get('tab') as TabKey) || 'calls';

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
    scheduleId?: string;
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
    updateFilters({ tab: tab === 'calls' ? '' : tab, page: '' });
  };

  return (
    <div>
      <PageHeader
        title="Installments"
        description="Schedules, overdue balances and daily collections."
        actions={
          <Tabs
            aria-label="Installment view"
            value={activeTab}
            onChange={(key) => setActiveTab(key as TabKey)}
            items={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
            className="max-w-full overflow-x-auto"
          />
        }
      />

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
                    'appearance-none rounded-md border bg-field pl-3 pr-8 py-2 text-sm',
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
                    'w-full rounded-md border bg-field pl-9 pr-9 py-2 text-sm',
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
              <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <p>
                  {searchResults.length} result{searchResults.length === 1 ? '' : 's'} found
                </p>
                <div className="flex items-center gap-3">
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
                  {/* Total Due across every pending installment of every
                      matched schedule. Same look as the chip on the other
                      tabs so users recognise it instantly. */}
                  <TotalDueChip
                    amount={searchResults.reduce(
                      (sum: number, sch: any) =>
                        sum +
                        ((sch.installments ?? []) as Array<{ remainingAmount: unknown }>).reduce(
                          (s2, i) => s2 + Number(i.remainingAmount ?? 0),
                          0,
                        ),
                      0,
                    )}
                    count={searchResults.reduce(
                      (n: number, sch: any) =>
                        n +
                        ((sch.installments ?? []) as Array<{ remainingAmount: unknown }>).filter(
                          (i) => Number(i.remainingAmount ?? 0) > 0,
                        ).length,
                      0,
                    )}
                    label="Total Due"
                    variant="red"
                  />
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
                      <div
                        className={cn(
                          'flex w-full items-center gap-3 p-3 transition-colors',
                          'hover:bg-muted/50',
                          isExpanded && 'border-b',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleScheduleExpanded(schedule.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/installments/${schedule.id}`);
                          }}
                          className={cn(
                            'flex flex-shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                            'hover:bg-muted transition-colors',
                          )}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                      </div>

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
                                              scheduleId: schedule.id,
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
      {activeTab === 'calls' && <CallListTab />}
      {activeTab === 'collections' && <CollectionsTab />}
      {activeTab === 'overdue' && <OverdueTab />}
      {activeTab === 'paid' && <PaidTab />}

      {/* Payment dialog for search results */}
      {searchPaymentTarget && (
        <RecordPaymentDialog
          installmentId={searchPaymentTarget.id}
          amountDue={searchPaymentTarget.amount}
          installmentNumber={searchPaymentTarget.number}
          defaultDate={searchPaymentTarget.dueDate}
          scheduleId={searchPaymentTarget.scheduleId}
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
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));
  const canSeeZone = usePermission('view.customer.address.zone');
  const [zoneFilter, setZoneFilter] = useState('');
  const { data: overdueItems, isLoading, isError } = useOverdueInstallmentsQuery(zoneFilter || undefined);

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
    scheduleId?: string;
  } | null>(null);

  const columns: Column<OverdueInstallmentItem>[] = useMemo(
    () => [
      ...(allShopsMode
        ? ([
            {
              key: 'shop' as keyof OverdueInstallmentItem,
              header: 'Shop',
              sortable: true,
              sortAccessor: (row: OverdueInstallmentItem) => row.shop?.code ?? '',
              render: (row: OverdueInstallmentItem) =>
                row.shop ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    {row.shop.code}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
              className: 'w-20',
            },
          ] as Column<OverdueInstallmentItem>[])
        : []),
      {
        key: 'ledger' as keyof OverdueInstallmentItem,
        header: 'Ledger',
        sortable: true,
        sortAccessor: (row) => row.ledgerNumber ?? '',
        render: (row) => (
          <span className="font-mono text-xs">{row.ledgerNumber || '-'}</span>
        ),
        className: 'w-24',
      },
      {
        key: 'customer',
        header: 'Customer',
        sortable: true,
        sortAccessor: (row) => row.customerName ?? '',
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
        sortable: true,
        sortAccessor: (row) => `${row.productBrand ?? ''} ${row.productName ?? ''}`.trim(),
        render: (row) => (
          <span className="text-sm">{row.productBrand} {row.productName}</span>
        ),
      },
      {
        key: 'emiNumber',
        header: 'EMI #',
        sortable: true,
        sortAccessor: (row) => row.installmentNumber,
        render: (row) => (
          <span className="text-sm font-medium">{formatInstallmentLabel(row)}</span>
        ),
      },
      {
        key: 'amountDue',
        header: 'Amount Due',
        align: 'right' as const,
        sortable: true,
        sortAccessor: (row) => Number(row.remainingAmount) || 0,
        render: (row) => (
          <span className="font-semibold text-red-600">
            {formatINR(row.remainingAmount)}
          </span>
        ),
      },
      {
        key: 'dueDate',
        header: 'Due Date',
        sortable: true,
        sortAccessor: (row) => new Date(row.dueDate),
        render: (row) => (
          <span className="text-sm">{formatDateIN(row.dueDate)}</span>
        ),
      },
      {
        key: 'daysOverdue',
        header: 'Days Overdue',
        align: 'right' as const,
        sortable: true,
        sortAccessor: (row) => Number(row.daysOverdue) || 0,
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
                  scheduleId: row.scheduleId,
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
    [navigate, allShopsMode],
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
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {canSeeZone && <ZoneFilter value={zoneFilter} onChange={setZoneFilter} />}
        <TotalDueChip
          amount={(overdueItems ?? []).reduce(
            (sum, r) => sum + Number(r.remainingAmount ?? 0),
            0,
          )}
          count={(overdueItems ?? []).length}
          label="Total Overdue"
          variant="red"
        />
      </div>
      <DataTable<OverdueInstallmentItem>
        columns={columns}
        data={overdueItems ?? []}
        isLoading={isLoading}
        emptyMessage="No overdue installments. Great job!"
        rowKey={(row) => row.id}
        defaultSort={{ key: 'dueDate', dir: 'desc' }}
      />

      {paymentTarget && (
        <RecordPaymentDialog
          installmentId={paymentTarget.id}
          amountDue={paymentTarget.amount}
          installmentNumber={paymentTarget.number}
          scheduleId={paymentTarget.scheduleId}
          onSuccess={() => setPaymentTarget(null)}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's Scheduled Tab (date range)
// ---------------------------------------------------------------------------
/** Local-timezone YYYY-MM-DD (avoids UTC toISOString offset bugs at midnight). */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDateDaysAgo(days: number): string {
  return toLocalDateStr(new Date(Date.now() - days * 86400000));
}

function CollectionsTab() {
  const navigate = useNavigate();
  const today = toLocalDateStr(new Date());
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));
  const canSeeZone = usePermission('view.customer.address.zone');

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [zoneFilter, setZoneFilter] = useState('');

  const { data: rangeData, isLoading, isError } = useCollectionsRangeQuery(dateFrom, dateTo, zoneFilter || undefined);
  const collections = rangeData?.collections ?? [];

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
    scheduleId?: string;
  } | null>(null);

  const isTodayOnly = dateFrom === today && dateTo === today;

  const collectionColumns: Column<CollectionItem>[] = useMemo(
    () => [
      ...(allShopsMode
        ? ([
            {
              key: 'shop' as keyof CollectionItem,
              header: 'Shop',
              sortable: true,
              sortAccessor: (row: CollectionItem) => row.shop?.code ?? '',
              render: (row: CollectionItem) =>
                row.shop ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    {row.shop.code}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
              className: 'w-20',
            },
          ] as Column<CollectionItem>[])
        : []),
      {
        key: 'ledger' as keyof CollectionItem,
        header: 'Ledger',
        sortable: true,
        sortAccessor: (row) => row.ledgerNumber ?? '',
        render: (row) => (
          <span className="font-mono text-xs">{row.ledgerNumber || '-'}</span>
        ),
        className: 'w-24',
      },
      {
        key: 'dueDate',
        header: 'Due Date',
        sortable: true,
        sortAccessor: (row) => new Date(row.dueDate),
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
        sortable: true,
        sortAccessor: (row) => row.customerName ?? '',
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
        sortable: true,
        sortAccessor: (row) => `${row.productBrand ?? ''} ${row.productName ?? ''}`.trim(),
        render: (row) => (
          <span className="text-sm">{row.productBrand} {row.productName}</span>
        ),
      },
      {
        key: 'emiNumber',
        header: 'EMI #',
        sortable: true,
        sortAccessor: (row) => row.installmentNumber,
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
        sortable: true,
        sortAccessor: (row) => Number(row.remainingAmount) || 0,
        render: (row) => (
          <span className="font-semibold">{formatINR(row.remainingAmount)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortAccessor: (row) => row.status,
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
                  scheduleId: (row as any).scheduleId,
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
    [navigate, today, allShopsMode],
  );

  return (
    <div>
      {/* Date range picker */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium">From:</label>
        </div>
        <DateInput
          value={dateFrom}
          onChange={(v) => setDateFrom(v)}
          className="w-40"
        />
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">To:</label>
        </div>
        <DateInput
          value={dateTo}
          onChange={(v) => setDateTo(v)}
          className="w-40"
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
          <button
            onClick={() => {
              const { dateFrom: fyStart, dateTo: fyEnd } = getCurrentFinancialYearRange();
              setDateFrom(fyStart);
              setDateTo(fyEnd);
            }}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Current Financial Year
          </button>
          <button
            onClick={() => {
              const { dateFrom: fyStart, dateTo: fyEnd } = getLastFinancialYearRange();
              setDateFrom(fyStart);
              setDateTo(fyEnd);
            }}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Last Financial Year
          </button>
          {canSeeZone && <ZoneFilter value={zoneFilter} onChange={setZoneFilter} />}
          <TotalDueChip
            amount={collections.reduce(
              (sum: number, c: CollectionItem) => sum + Number(c.remainingAmount ?? 0),
              0,
            )}
            count={collections.length}
            label="Total Due"
            variant="amber"
          />
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
          {/* Table — totals are surfaced in the TotalDueChip at the top */}
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
          scheduleId={paymentTarget.scheduleId}
          onSuccess={() => setPaymentTarget(null)}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paid Tab — installments whose dueDate is in the range AND have payments
// ---------------------------------------------------------------------------
function PaidTab() {
  const navigate = useNavigate();
  const today = toLocalDateStr(new Date());
  const allShopsMode = isAllShops(useShopStore((s) => s.currentShopId));
  const canSeeZone = usePermission('view.customer.address.zone');

  const [dateFrom, setDateFrom] = useState(getDateDaysAgo(14));
  const [dateTo, setDateTo] = useState(today);
  const [zoneFilter, setZoneFilter] = useState('');

  const { data, isLoading, isError } = usePaidCollectionsRangeQuery(dateFrom, dateTo, zoneFilter || undefined);
  const rows = data ?? [];

  const totalCollected = rows.reduce(
    (sum, r) => sum + Number(r.amountPaid ?? 0),
    0,
  );
  const fullyPaidCount = rows.filter((r) => r.status === 'paid').length;
  const partialCount = rows.filter((r) => r.status === 'partially_paid').length;

  const columns: Column<PaidCollectionItem>[] = useMemo(
    () => [
      ...(allShopsMode
        ? ([
            {
              key: 'shop' as keyof PaidCollectionItem,
              header: 'Shop',
              sortable: true,
              sortAccessor: (row: PaidCollectionItem) => row.shop?.code ?? '',
              render: (row: PaidCollectionItem) =>
                row.shop ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    {row.shop.code}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
              className: 'w-20',
            },
          ] as Column<PaidCollectionItem>[])
        : []),
      {
        key: 'ledger' as keyof PaidCollectionItem,
        header: 'Ledger',
        sortable: true,
        sortAccessor: (row) => row.ledgerNumber ?? '',
        render: (row) => (
          <span className="font-mono text-xs">{row.ledgerNumber || '-'}</span>
        ),
        className: 'w-24',
      },
      {
        key: 'dueDate',
        header: 'Due Date',
        sortable: true,
        sortAccessor: (row) => new Date(row.dueDate),
        render: (row) => (
          <span className="text-sm">{formatDateIN(row.dueDate)}</span>
        ),
      },
      {
        key: 'paymentDate',
        header: 'First Paid',
        sortable: true,
        sortAccessor: (row) => (row.firstPaymentDate ? new Date(row.firstPaymentDate) : null),
        render: (row) =>
          row.firstPaymentDate ? (
            <div className="flex flex-col">
              <span className="text-sm">{formatDateIN(row.firstPaymentDate)}</span>
              {row.daysFromDue !== null && (
                <span
                  className={cn(
                    'text-[10px] font-medium',
                    row.daysFromDue <= 0
                      ? 'text-green-600'
                      : row.daysFromDue <= 7
                        ? 'text-yellow-600'
                        : 'text-red-600',
                  )}
                >
                  {row.daysFromDue === 0
                    ? 'on time'
                    : row.daysFromDue < 0
                      ? `${-row.daysFromDue}d early`
                      : `${row.daysFromDue}d late`}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: 'customer',
        header: 'Customer',
        sortable: true,
        sortAccessor: (row) => row.customerName ?? '',
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
        sortable: true,
        sortAccessor: (row) => `${row.productBrand ?? ''} ${row.productName ?? ''}`.trim(),
        render: (row) => (
          <span className="text-sm">
            {row.productBrand} {row.productName}
          </span>
        ),
      },
      {
        key: 'emiNumber',
        header: 'EMI #',
        sortable: true,
        sortAccessor: (row) => row.installmentNumber,
        render: (row) => (
          <span className="text-sm font-medium">
            {formatInstallmentLabel(row)} of {row.totalInstallments}
          </span>
        ),
      },
      {
        key: 'amountPaid',
        header: 'Paid',
        align: 'right' as const,
        sortable: true,
        sortAccessor: (row) => Number(row.amountPaid) || 0,
        render: (row) => (
          <span className="font-semibold text-green-700">
            {formatINR(row.amountPaid)}
          </span>
        ),
      },
      {
        key: 'amountDue',
        header: 'Due',
        align: 'right' as const,
        sortable: true,
        sortAccessor: (row) => Number(row.amountDue) || 0,
        render: (row) => (
          <span className="text-sm">{formatINR(row.amountDue)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortAccessor: (row) => row.status,
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
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
        ),
      },
    ],
    [navigate, allShopsMode],
  );

  return (
    <div>
      {/* Date range picker */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium">From:</label>
        </div>
        <DateInput
          value={dateFrom}
          onChange={(v) => setDateFrom(v)}
          className="w-40"
        />
        <label className="text-sm font-medium">To:</label>
        <DateInput
          value={dateTo}
          onChange={(v) => setDateTo(v)}
          className="w-40"
        />
        <button
          onClick={() => {
            setDateFrom(today);
            setDateTo(today);
          }}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Today
        </button>
        <button
          onClick={() => {
            setDateFrom(getDateDaysAgo(7));
            setDateTo(today);
          }}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Last 7 Days
        </button>
        <button
          onClick={() => {
            setDateFrom(getDateDaysAgo(30));
            setDateTo(today);
          }}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Last 30 Days
        </button>
        <button
          onClick={() => {
            const { dateFrom: fyStart, dateTo: fyEnd } = getCurrentFinancialYearRange();
            setDateFrom(fyStart);
            setDateTo(fyEnd);
          }}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Current Financial Year
        </button>
        <button
          onClick={() => {
            const { dateFrom: fyStart, dateTo: fyEnd } = getLastFinancialYearRange();
            setDateFrom(fyStart);
            setDateTo(fyEnd);
          }}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Last Financial Year
        </button>
        {canSeeZone && <ZoneFilter value={zoneFilter} onChange={setZoneFilter} />}
        <TotalDueChip
          amount={totalCollected}
          count={rows.length}
          label="Total Collected"
          variant="green"
        />
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
            Failed to load paid installments
          </p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CalendarDays className="h-12 w-12 mb-3 opacity-50" />
          <p className="text-lg font-medium">No paid installments in this period</p>
          <p className="text-sm mt-1">
            No full or partial payments found against due dates between{' '}
            {formatDateIN(dateFrom)} and {formatDateIN(dateTo)}.
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && rows.length > 0 && (
        <div className="space-y-4">
          {/* Compact paid/partial breakdown — grand total + count are
              already in the TotalDueChip at the top. */}
          <div className="rounded-lg border bg-card p-4 flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Fully Paid
              </p>
              <p className="text-lg font-semibold text-green-700">
                {fullyPaidCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Partial
              </p>
              <p className="text-lg font-semibold text-amber-600">
                {partialCount}
              </p>
            </div>
          </div>

          <DataTable<PaidCollectionItem>
            columns={columns}
            data={rows}
            isLoading={false}
            emptyMessage=""
            rowKey={(row) => row.id}
          />
        </div>
      )}
    </div>
  );
}
