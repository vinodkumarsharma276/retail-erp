import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  ChevronDown,
  Calendar,
  Search,
  X,
  Pencil,
  Trash2,
  IndianRupee,
  Receipt,
  Check,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useExpensesQuery,
  useExpenseSummaryQuery,
  useDeleteExpenseMutation,
} from '../../hooks/useExpenses';
import type { Expense } from '../../hooks/useExpenses';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatINR, formatDateIN, getCurrentFinancialYearRange, getLastFinancialYearRange } from '@retailerp/shared-utils';
import { ExpenseCategory, UserRole } from '@retailerp/shared-types';
import { useAuthStore } from '../../stores/auth-store';

const PAGE_SIZE = 20;

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

const CATEGORY_OPTIONS = Object.values(ExpenseCategory);

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  electricity: 'Electricity',
  salary: 'Salary',
  transport: 'Transport',
  maintenance: 'Maintenance',
  marketing: 'Marketing',
  purchase: 'Purchase',
  misc: 'Misc',
};

export function ExpenseListPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;

  // ------ Filters state (URL search params) ------
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page')) || 1;
  const category = searchParams.get('category') || '';
  const dateFrom = searchParams.get('dateFrom') || getDateDaysAgo(90);
  const dateTo = searchParams.get('dateTo') || getToday();
  const search = searchParams.get('search') || '';
  const [searchInput, setSearchInput] = useState(search);

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

  // ------ Delete state ------
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteMutation = useDeleteExpenseMutation();

  // Expenses query
  const expensesQuery = useExpensesQuery({
    page,
    pageSize: PAGE_SIZE,
    category: category || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: search || undefined,
  });

  // Summary query
  const summaryQuery = useExpenseSummaryQuery(
    dateFrom || undefined,
    dateTo || undefined,
  );

  const expenses = expensesQuery.data?.data ?? [];
  const pagination = expensesQuery.data?.pagination;
  const summary = summaryQuery.data;

  // ------ Search handler ------
  const handleSearch = () => {
    updateFilters({ search: searchInput.trim(), page: '1' });
  };

  // ------ Clear filters ------
  const hasFilters = category || search || dateFrom !== getDateDaysAgo(90) || dateTo !== getToday();
  const clearFilters = () => {
    setSearchInput('');
    setSearchParams({}, { replace: true });
  };

  // ------ Delete handler ------
  const handleDelete = (id: string) => {
    if (!window.confirm('Are you sure you want to delete this expense?')) return;
    setDeletingId(id);
    deleteMutation.mutate(id, {
      onSettled: () => setDeletingId(null),
    });
  };

  // ------ Table columns ------
  const columns: Column<Expense>[] = [
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
      key: 'date',
      header: 'Date',
      render: (row) => formatDateIN(row.expenseDate),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <StatusBadge status={row.category} />
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (row) => (
        <span className="font-medium">{row.vendorName || '-'}</span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="text-muted-foreground" title={row.description}>
          {row.description && row.description.length > 50
            ? `${row.description.slice(0, 50)}...`
            : row.description || '-'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => (
        <span className="font-medium">{formatINR(row.amount)}</span>
      ),
    },
    {
      key: 'gst',
      header: 'GST',
      align: 'right',
      render: (row) => formatINR(row.gstAmount),
    },
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      render: (row) => (
        <span className="font-mono text-xs">{row.invoiceNumber ?? '-'}</span>
      ),
    },
    {
      key: 'gstClaimable',
      header: 'GST Claimable',
      align: 'center',
      render: (row) =>
        row.isGstClaimable ? (
          <Check className="h-4 w-4 text-green-600 mx-auto" />
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (row) => (
        <div className="flex items-center justify-center gap-2">
          <Link
            to={`/expenses/${row.id}/edit`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          {isAdmin && (
            <button
              onClick={() => handleDelete(row.id)}
              disabled={deletingId === row.id}
              className={cn(
                'rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
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
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <Link
          to="/expenses/new"
          className={cn(
            'flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
            'hover:bg-primary/90 transition-colors',
          )}
        >
          <Plus className="h-4 w-4" />
          Add Expense
        </Link>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-red-100 dark:bg-red-900/30 p-2">
                <IndianRupee className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Expenses</p>
                <p className="text-lg font-semibold">
                  {formatINR(summary.totalExpenses)}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-green-100 dark:bg-green-900/30 p-2">
                <Receipt className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  GST Claimable
                </p>
                <p className="text-lg font-semibold">
                  {formatINR(summary.totalGstClaimable)}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-blue-100 dark:bg-blue-900/30 p-2">
                <Receipt className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Categories</p>
                <p className="text-lg font-semibold">
                  {summary.byCategory?.length ?? 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        {/* Category dropdown */}
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Category
          </label>
          <div className="relative">
            <select
              value={category}
              onChange={(e) => {
                updateFilters({ category: e.target.value, page: '1' });
              }}
              className={cn(
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All Categories</option>
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat] ?? cat}
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

        {/* Search */}
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Search
          </label>
          <div className="flex">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                placeholder="Vendor or description..."
                className={cn(
                  'w-full rounded-l-md border bg-background pl-9 pr-3 py-2 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>
            <button
              onClick={handleSearch}
              className="rounded-r-md border border-l-0 bg-muted px-3 py-2 text-sm text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              Go
            </button>
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
      {expensesQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 text-sm text-destructive">
          Failed to load expenses. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<Expense>
        columns={columns}
        data={expenses}
        isLoading={expensesQuery.isLoading}
        pagination={paginationState}
        onPageChange={(p) => updateFilters({ page: String(p) })}
        emptyMessage="No expenses found matching your filters."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
