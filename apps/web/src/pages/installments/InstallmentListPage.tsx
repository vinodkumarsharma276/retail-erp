import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  CalendarDays,
  Phone,
  MapPin,
  Eye,
  Banknote,
  Calendar,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { DataTable, type Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { RecordPaymentDialog } from '../../components/RecordPaymentDialog';
import {
  useInstallmentSchedulesQuery,
  useOverdueInstallmentsQuery,
  useCollectionsQuery,
  type ScheduleListItem,
  type OverdueInstallmentItem,
  type CollectionItem,
} from '../../hooks/useInstallments';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
type TabKey = 'active' | 'overdue' | 'completed' | 'collections';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Active Schedules' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
  { key: 'collections', label: "Today's Collections" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function InstallmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get('tab') as TabKey) || 'collections';
  const page = Number(searchParams.get('page')) || 1;

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
      <div className="flex gap-1 rounded-lg bg-muted p-1 mb-6 overflow-x-auto">
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

      {/* Tab content */}
      {activeTab === 'active' && <ActiveSchedulesTab page={page} onPageChange={(p) => updateFilters({ page: String(p) })} />}
      {activeTab === 'overdue' && <OverdueTab />}
      {activeTab === 'completed' && <CompletedTab page={page} onPageChange={(p) => updateFilters({ page: String(p) })} />}
      {activeTab === 'collections' && <CollectionsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Schedules Tab
// ---------------------------------------------------------------------------
function ActiveSchedulesTab({ page, onPageChange }: { page: number; onPageChange: (p: number) => void }) {
  const navigate = useNavigate();
  const pageSize = 20;

  const { data, isLoading } = useInstallmentSchedulesQuery({
    page,
    pageSize,
    status: 'active',
  });

  const columns: Column<ScheduleListItem>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <div>
            <button
              onClick={() => navigate(`/installments/${row.id}`)}
              className="font-medium text-primary hover:underline text-left"
            >
              {row.customerName}
            </button>
            <p className="text-xs text-muted-foreground">{row.customerPhone}</p>
          </div>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        render: (row) => (
          <div>
            <p className="text-sm">{row.productBrand}</p>
            <p className="text-xs text-muted-foreground">{row.productName}</p>
          </div>
        ),
      },
      {
        key: 'emiAmount',
        header: 'EMI Amount',
        align: 'right' as const,
        render: (row) => (
          <span className="font-medium">{formatINR(row.emiAmount)}</span>
        ),
      },
      {
        key: 'progress',
        header: 'Total / Paid / Remaining',
        render: (row) => (
          <div className="text-sm">
            <span>{formatINR(row.totalPayable)}</span>
            <span className="text-green-600 mx-1">/</span>
            <span className="text-green-600">{formatINR(row.totalPaid)}</span>
            <span className="text-red-600 mx-1">/</span>
            <span className="text-red-600">{formatINR(row.totalRemaining)}</span>
          </div>
        ),
      },
      {
        key: 'nextDue',
        header: 'Next Due Date',
        render: (row) =>
          row.nextDueDate ? (
            <span className="text-sm">{formatDateIN(row.nextDueDate)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">--</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [navigate],
  );

  return (
    <DataTable<ScheduleListItem>
      columns={columns}
      data={data?.data ?? []}
      isLoading={isLoading}
      emptyMessage="No active installment schedules."
      rowKey={(row) => row.id}
      pagination={
        data?.pagination
          ? {
              page: data.pagination.page,
              totalPages: data.pagination.totalPages,
              totalItems: data.pagination.totalItems,
              pageSize: data.pagination.pageSize,
            }
          : undefined
      }
      onPageChange={onPageChange}
    />
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
            <a
              href={`tel:${row.customerPhone}`}
              className="text-xs text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.customerPhone}
            </a>
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
          <span className="text-sm font-medium">#{row.installmentNumber}</span>
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
                ? 'bg-red-100 text-red-700'
                : row.daysOverdue > 7
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-yellow-100 text-yellow-700',
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
// Completed Tab
// ---------------------------------------------------------------------------
function CompletedTab({ page, onPageChange }: { page: number; onPageChange: (p: number) => void }) {
  const navigate = useNavigate();
  const pageSize = 20;

  const { data, isLoading } = useInstallmentSchedulesQuery({
    page,
    pageSize,
    status: 'completed',
  });

  const columns: Column<ScheduleListItem>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <div>
            <button
              onClick={() => navigate(`/installments/${row.id}`)}
              className="font-medium text-primary hover:underline text-left"
            >
              {row.customerName}
            </button>
            <p className="text-xs text-muted-foreground">{row.customerPhone}</p>
          </div>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        render: (row) => (
          <div>
            <p className="text-sm">{row.productBrand}</p>
            <p className="text-xs text-muted-foreground">{row.productName}</p>
          </div>
        ),
      },
      {
        key: 'emiAmount',
        header: 'EMI Amount',
        align: 'right' as const,
        render: (row) => (
          <span className="font-medium">{formatINR(row.emiAmount)}</span>
        ),
      },
      {
        key: 'totalPayable',
        header: 'Total Paid',
        align: 'right' as const,
        render: (row) => (
          <span className="font-medium text-green-600">
            {formatINR(row.totalPaid)}
          </span>
        ),
      },
      {
        key: 'installments',
        header: 'Installments',
        render: (row) => (
          <span className="text-sm">{row.numInstallments} EMIs</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [navigate],
  );

  return (
    <DataTable<ScheduleListItem>
      columns={columns}
      data={data?.data ?? []}
      isLoading={isLoading}
      emptyMessage="No completed installment schedules yet."
      rowKey={(row) => row.id}
      pagination={
        data?.pagination
          ? {
              page: data.pagination.page,
              totalPages: data.pagination.totalPages,
              totalItems: data.pagination.totalItems,
              pageSize: data.pagination.pageSize,
            }
          : undefined
      }
      onPageChange={onPageChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Today's Collections Tab
// ---------------------------------------------------------------------------
function CollectionsTab() {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: collections, isLoading, isError } = useCollectionsQuery(selectedDate);

  // Payment dialog state
  const [paymentTarget, setPaymentTarget] = useState<{
    id: string;
    amount: number;
    number: number;
  } | null>(null);

  const isToday = selectedDate === today;

  return (
    <div>
      {/* Date picker */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium">Collection Date:</label>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className={cn(
            'rounded-md border bg-background px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          )}
        />
        {!isToday && (
          <button
            onClick={() => setSelectedDate(today)}
            className="text-sm text-primary hover:underline"
          >
            Back to Today
          </button>
        )}
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
      {!isLoading && !isError && collections && collections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CalendarDays className="h-12 w-12 mb-3 opacity-50" />
          <p className="text-lg font-medium">No collections for this date</p>
          <p className="text-sm mt-1">
            {isToday
              ? 'No installments are due today.'
              : `No installments were due on ${formatDateIN(selectedDate)}.`}
          </p>
        </div>
      )}

      {/* Collection cards */}
      {!isLoading && !isError && collections && collections.length > 0 && (
        <div className="space-y-3">
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
                  collections.reduce((sum, c) => sum + c.remainingAmount, 0),
                )}
              </p>
            </div>
          </div>

          {/* Cards */}
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            {collections.map((item) => (
              <CollectionCard
                key={item.id}
                item={item}
                onRecordPayment={() =>
                  setPaymentTarget({
                    id: item.id,
                    amount: item.remainingAmount,
                    number: item.installmentNumber,
                  })
                }
                onViewSale={() => navigate(`/sales/${item.saleId}`)}
              />
            ))}
          </div>
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

// ---------------------------------------------------------------------------
// Collection Card
// ---------------------------------------------------------------------------
function CollectionCard({
  item,
  onRecordPayment,
  onViewSale,
}: {
  item: CollectionItem;
  onRecordPayment: () => void;
  onViewSale: () => void;
}) {
  const statusIndicator = getCollectionStatus(item);

  return (
    <div className="rounded-lg border bg-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base truncate">
            {item.customerName}
          </h3>
          <a
            href={`tel:${item.customerPhone}`}
            className="flex items-center gap-1 text-sm text-primary hover:underline mt-0.5"
          >
            <Phone className="h-3.5 w-3.5" />
            {item.customerPhone}
          </a>
        </div>
        {/* Status indicator */}
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium shrink-0',
            statusIndicator.bg,
            statusIndicator.text,
          )}
        >
          {statusIndicator.label}
        </span>
      </div>

      {/* Product + EMI info */}
      <div className="space-y-1 mb-3">
        <p className="text-sm text-muted-foreground">
          {item.productBrand} {item.productName}
        </p>
        <p className="text-sm">
          <span className="font-medium">
            EMI {item.installmentNumber} of {item.totalInstallments}
          </span>
        </p>
      </div>

      {/* Amount */}
      <div className="mb-3">
        <p className="text-2xl font-bold">{formatINR(item.remainingAmount)}</p>
      </div>

      {/* Address */}
      {item.customerAddress && (
        <div className="flex items-start gap-1 mb-3 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{item.customerAddress}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <button
          onClick={onRecordPayment}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white',
            'hover:bg-green-700 transition-colors',
          )}
        >
          <Banknote className="h-4 w-4" />
          Record Payment
        </button>
        <button
          onClick={onViewSale}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
            'hover:bg-muted transition-colors',
          )}
        >
          <Eye className="h-4 w-4" />
          View Sale
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getCollectionStatus(item: CollectionItem): {
  bg: string;
  text: string;
  label: string;
} {
  if (item.status === 'overdue' || item.daysOverdue > 0) {
    return {
      bg: 'bg-red-100',
      text: 'text-red-700',
      label: `Overdue ${item.daysOverdue}d`,
    };
  }
  if (item.status === 'rescheduled') {
    return {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      label: 'Rescheduled',
    };
  }
  return {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    label: 'Due Today',
  };
}
