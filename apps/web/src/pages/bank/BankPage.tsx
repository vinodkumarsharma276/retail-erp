import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Plus,
  Loader2,
  AlertCircle,
  X,
  Calendar,
  ChevronDown,
  Upload,
  Landmark,
  Eye,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useBankAccountsQuery,
  useCreateBankAccountMutation,
  useBankTransactionsQuery,
  useAddBankTransactionMutation,
} from '../../hooks/useBank';
import type {
  BankAccount,
  BankTransaction,
  BankTransactionFilters,
} from '../../hooks/useBank';
import { DataTable } from '../../components/DataTable';
import type { Column, PaginationState } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { UploadStatementDialog } from '../../components/UploadStatementDialog';
import { ReconciliationPanel } from '../../components/ReconciliationPanel';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import { ReconciliationStatus, UserRole } from '@retailerp/shared-types';
import { useAuthStore } from '../../stores/auth-store';

const PAGE_SIZE = 20;

// Mask account number: show last 4 digits
function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return 'XXXX' + accountNumber.slice(-4);
}

// ---------------------------------------------------------------------------
// Main BankPage
// ---------------------------------------------------------------------------
export function BankPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.ADMIN;

  const accountsQuery = useBankAccountsQuery();
  const accounts = accountsQuery.data ?? [];

  const [activeAccountIndex, setActiveAccountIndex] = useState(0);
  const [showCreateAccountDialog, setShowCreateAccountDialog] = useState(false);

  const activeAccount = accounts[activeAccountIndex] ?? null;

  // Loading
  if (accountsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error
  if (accountsQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load bank accounts. Please try again.
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Bank Statements</h1>
        {isAdmin && (
          <button
            onClick={() => setShowCreateAccountDialog(true)}
            className={cn(
              'flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
            )}
          >
            <Plus className="h-4 w-4" />
            Add Bank Account
          </button>
        )}
      </div>

      {/* Empty state */}
      {accounts.length === 0 && (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Landmark className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-medium mb-2">No Bank Accounts</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Create your first bank account to start tracking transactions and
            reconciling statements.
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowCreateAccountDialog(true)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
              )}
            >
              <Plus className="h-4 w-4" />
              Create Bank Account
            </button>
          )}
        </div>
      )}

      {/* Account tabs */}
      {accounts.length > 0 && (
        <div>
          {/* Tab bar */}
          <div className="flex border-b mb-0 overflow-x-auto">
            {accounts.map((account, idx) => (
              <button
                key={account.id}
                onClick={() => setActiveAccountIndex(idx)}
                className={cn(
                  'px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  idx === activeAccountIndex
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
                )}
              >
                {account.bankName} ({maskAccountNumber(account.accountNumber)})
              </button>
            ))}
          </div>

          {/* Active account content */}
          {activeAccount && (
            <AccountTabContent account={activeAccount} isAdmin={isAdmin} />
          )}
        </div>
      )}

      {/* Create account dialog */}
      {showCreateAccountDialog && (
        <CreateBankAccountDialog
          onClose={() => setShowCreateAccountDialog(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Tab Content
// ---------------------------------------------------------------------------
function AccountTabContent({
  account,
  isAdmin,
}: {
  account: BankAccount;
  isAdmin: boolean;
}) {
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reconciliationStatus, setReconciliationStatus] = useState('');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showAddTransactionDialog, setShowAddTransactionDialog] =
    useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<BankTransaction | null>(null);

  const filters: BankTransactionFilters = {
    page,
    pageSize: PAGE_SIZE,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    reconciliationStatus: reconciliationStatus || undefined,
  };

  const transactionsQuery = useBankTransactionsQuery(account.id, filters);
  const transactions = transactionsQuery.data?.data ?? [];
  const pagination = transactionsQuery.data?.pagination;

  // Clear filters
  const hasFilters = dateFrom || dateTo || reconciliationStatus;
  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setReconciliationStatus('');
    setPage(1);
  };

  // Handle click on unmatched transaction
  const handleTransactionClick = (txn: BankTransaction) => {
    if (txn.reconciliationStatus === 'unmatched') {
      setSelectedTransaction(txn);
    }
  };

  // Table columns
  const columns: Column<BankTransaction>[] = [
    {
      key: 'sno',
      header: 'S.No',
      render: (_row, idx) =>
        pagination
          ? (pagination.page - 1) * pagination.pageSize + idx + 1
          : idx + 1,
      className: 'w-14',
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => formatDateIN(row.transactionDate),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span
          className="max-w-[250px] truncate block"
          title={row.description}
        >
          {row.description}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => (
        <span className="font-mono text-xs">
          {row.referenceNumber ?? '-'}
        </span>
      ),
    },
    {
      key: 'debit',
      header: 'Debit',
      align: 'right',
      render: (row) =>
        row.type === 'debit' ? (
          <span className="text-red-600 font-medium">
            {formatINR(row.amount)}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      render: (row) =>
        row.type === 'credit' ? (
          <span className="text-green-600 font-medium">
            {formatINR(row.amount)}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (row) => formatINR(row.balance),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.reconciliationStatus} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (row) =>
        row.reconciliationStatus === 'unmatched' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTransaction(row);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Reconcile"
          >
            <Eye className="h-4 w-4" />
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ];

  const paginationState: PaginationState | undefined = pagination
    ? {
        page: pagination.page,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        pageSize: pagination.pageSize,
      }
    : undefined;

  return (
    <div className="mt-6 space-y-6">
      {/* Account info bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-xs text-muted-foreground">Bank</p>
            <p className="text-sm font-medium">{account.bankName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Account Number</p>
            <p className="text-sm font-mono">
              {maskAccountNumber(account.accountNumber)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">IFSC</p>
            <p className="text-sm font-mono">{account.ifscCode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="text-sm font-medium capitalize">
              {account.accountType}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Opening Balance</p>
            <p className="text-sm font-medium">
              {formatINR(account.openingBalance)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Current Balance</p>
            <p className="text-sm font-semibold text-green-600">
              {formatINR(account.currentBalance)}
            </p>
          </div>
        </div>
      </div>

      {/* Action buttons + Filters */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Upload Statement */}
        <button
          onClick={() => setShowUploadDialog(true)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
            'hover:bg-muted transition-colors',
          )}
        >
          <Upload className="h-4 w-4" />
          Upload Statement
        </button>

        {/* Add Transaction */}
        <button
          onClick={() => setShowAddTransactionDialog(true)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium',
            'hover:bg-muted transition-colors',
          )}
        >
          <Plus className="h-4 w-4" />
          Add Transaction
        </button>

        <div className="flex-1" />

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
                setDateFrom(e.target.value);
                setPage(1);
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
                setDateTo(e.target.value);
                setPage(1);
              }}
              className={cn(
                'rounded-md border bg-background pl-9 pr-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>
        </div>

        {/* Reconciliation Status */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Reconciliation
          </label>
          <div className="relative">
            <select
              value={reconciliationStatus}
              onChange={(e) => {
                setReconciliationStatus(e.target.value);
                setPage(1);
              }}
              className={cn(
                'w-full appearance-none rounded-md border bg-background px-3 py-2 pr-8 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            >
              <option value="">All</option>
              <option value={ReconciliationStatus.UNMATCHED}>Unmatched</option>
              <option value={ReconciliationStatus.MATCHED}>Matched</option>
              <option value={ReconciliationStatus.MANUAL_MATCH}>
                Manual Match
              </option>
              <option value={ReconciliationStatus.DISPUTED}>Disputed</option>
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
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {transactionsQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load transactions. Please try again.
        </div>
      )}

      {/* Data table */}
      <DataTable<BankTransaction>
        columns={columns}
        data={transactions}
        isLoading={transactionsQuery.isLoading}
        pagination={paginationState}
        onPageChange={setPage}
        emptyMessage="No transactions found."
        rowKey={(row) => row.id}
      />

      {/* Upload statement dialog */}
      {showUploadDialog && (
        <UploadStatementDialog
          accountId={account.id}
          onClose={() => setShowUploadDialog(false)}
        />
      )}

      {/* Add transaction dialog */}
      {showAddTransactionDialog && (
        <AddTransactionDialog
          accountId={account.id}
          onClose={() => setShowAddTransactionDialog(false)}
        />
      )}

      {/* Reconciliation panel */}
      {selectedTransaction && (
        <ReconciliationPanel
          transaction={selectedTransaction}
          onClose={() => setSelectedTransaction(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Bank Account Dialog
// ---------------------------------------------------------------------------
interface CreateAccountFormValues {
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: string;
  openingBalance: number | '';
}

function CreateBankAccountDialog({ onClose }: { onClose: () => void }) {
  const createMutation = useCreateBankAccountMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateAccountFormValues>({
    defaultValues: {
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      accountType: 'current',
      openingBalance: '',
    },
  });

  const onSubmit = (formData: CreateAccountFormValues) => {
    createMutation.mutate(
      {
        bankName: formData.bankName.trim(),
        accountNumber: formData.accountNumber.trim(),
        ifscCode: formData.ifscCode.trim(),
        accountType: formData.accountType,
        openingBalance: formData.openingBalance
          ? Number(formData.openingBalance)
          : 0,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  const mutationError = createMutation.error
    ? (createMutation.error as any)?.response?.data?.error ??
      (createMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Add Bank Account</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Bank Name */}
          <div>
            <label
              htmlFor="ba-bankName"
              className="block text-sm font-medium mb-1.5"
            >
              Bank Name <span className="text-destructive">*</span>
            </label>
            <input
              id="ba-bankName"
              type="text"
              {...register('bankName', {
                required: 'Bank name is required',
              })}
              placeholder="e.g. State Bank of India"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.bankName && 'border-destructive',
              )}
            />
            {errors.bankName && (
              <p className="mt-1 text-xs text-destructive">
                {errors.bankName.message}
              </p>
            )}
          </div>

          {/* Account Number */}
          <div>
            <label
              htmlFor="ba-accountNumber"
              className="block text-sm font-medium mb-1.5"
            >
              Account Number <span className="text-destructive">*</span>
            </label>
            <input
              id="ba-accountNumber"
              type="text"
              {...register('accountNumber', {
                required: 'Account number is required',
              })}
              placeholder="e.g. 1234567890"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.accountNumber && 'border-destructive',
              )}
            />
            {errors.accountNumber && (
              <p className="mt-1 text-xs text-destructive">
                {errors.accountNumber.message}
              </p>
            )}
          </div>

          {/* IFSC Code */}
          <div>
            <label
              htmlFor="ba-ifscCode"
              className="block text-sm font-medium mb-1.5"
            >
              IFSC Code <span className="text-destructive">*</span>
            </label>
            <input
              id="ba-ifscCode"
              type="text"
              {...register('ifscCode', {
                required: 'IFSC code is required',
                pattern: {
                  value: /^[A-Z]{4}0[A-Z0-9]{6}$/,
                  message: 'Enter a valid IFSC code',
                },
              })}
              placeholder="e.g. SBIN0001234"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm uppercase',
                'placeholder:text-muted-foreground placeholder:normal-case',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.ifscCode && 'border-destructive',
              )}
            />
            {errors.ifscCode && (
              <p className="mt-1 text-xs text-destructive">
                {errors.ifscCode.message}
              </p>
            )}
          </div>

          {/* Account Type */}
          <div>
            <label
              htmlFor="ba-accountType"
              className="block text-sm font-medium mb-1.5"
            >
              Account Type <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <select
                id="ba-accountType"
                {...register('accountType', {
                  required: 'Account type is required',
                })}
                className={cn(
                  'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              >
                <option value="current">Current</option>
                <option value="savings">Savings</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Opening Balance */}
          <div>
            <label
              htmlFor="ba-openingBalance"
              className="block text-sm font-medium mb-1.5"
            >
              Opening Balance
            </label>
            <input
              id="ba-openingBalance"
              type="number"
              step="0.01"
              {...register('openingBalance', {
                min: { value: 0, message: 'Balance cannot be negative' },
              })}
              placeholder="0.00"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.openingBalance && 'border-destructive',
              )}
            />
            {errors.openingBalance && (
              <p className="mt-1 text-xs text-destructive">
                {errors.openingBalance.message}
              </p>
            )}
          </div>

          {/* Error */}
          {mutationError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {mutationError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className={cn(
                'flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Account'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Transaction Dialog
// ---------------------------------------------------------------------------
interface AddTransactionFormValues {
  transactionDate: string;
  description: string;
  referenceNumber: string;
  type: string;
  amount: number | '';
  balance: number | '';
}

function AddTransactionDialog({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const addMutation = useAddBankTransactionMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddTransactionFormValues>({
    defaultValues: {
      transactionDate: new Date().toISOString().split('T')[0],
      description: '',
      referenceNumber: '',
      type: 'debit',
      amount: '',
      balance: '',
    },
  });

  const onSubmit = (formData: AddTransactionFormValues) => {
    addMutation.mutate(
      {
        accountId,
        payload: {
          transactionDate: formData.transactionDate,
          description: formData.description.trim(),
          referenceNumber: formData.referenceNumber.trim() || undefined,
          type: formData.type,
          amount: Number(formData.amount),
          balance: Number(formData.balance),
        },
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  const mutationError = addMutation.error
    ? (addMutation.error as any)?.response?.data?.error ??
      (addMutation.error as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Add Transaction</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Transaction Date */}
          <div>
            <label
              htmlFor="txn-date"
              className="block text-sm font-medium mb-1.5"
            >
              Transaction Date <span className="text-destructive">*</span>
            </label>
            <input
              id="txn-date"
              type="date"
              {...register('transactionDate', {
                required: 'Transaction date is required',
              })}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.transactionDate && 'border-destructive',
              )}
            />
            {errors.transactionDate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.transactionDate.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="txn-description"
              className="block text-sm font-medium mb-1.5"
            >
              Description <span className="text-destructive">*</span>
            </label>
            <input
              id="txn-description"
              type="text"
              {...register('description', {
                required: 'Description is required',
              })}
              placeholder="Transaction description"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.description && 'border-destructive',
              )}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-destructive">
                {errors.description.message}
              </p>
            )}
          </div>

          {/* Reference Number */}
          <div>
            <label
              htmlFor="txn-ref"
              className="block text-sm font-medium mb-1.5"
            >
              Reference Number
            </label>
            <input
              id="txn-ref"
              type="text"
              {...register('referenceNumber')}
              placeholder="UTR / Cheque number"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>

          {/* Type (Credit/Debit radio) */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Type <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="debit"
                  {...register('type', { required: 'Type is required' })}
                  className="h-4 w-4 text-primary focus:ring-primary"
                />
                <span className="text-sm">Debit (Outgoing)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="credit"
                  {...register('type', { required: 'Type is required' })}
                  className="h-4 w-4 text-primary focus:ring-primary"
                />
                <span className="text-sm">Credit (Incoming)</span>
              </label>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label
              htmlFor="txn-amount"
              className="block text-sm font-medium mb-1.5"
            >
              Amount <span className="text-destructive">*</span>
            </label>
            <input
              id="txn-amount"
              type="number"
              step="0.01"
              {...register('amount', {
                required: 'Amount is required',
                min: { value: 0.01, message: 'Amount must be greater than 0' },
              })}
              placeholder="0.00"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.amount && 'border-destructive',
              )}
            />
            {errors.amount && (
              <p className="mt-1 text-xs text-destructive">
                {errors.amount.message}
              </p>
            )}
          </div>

          {/* Balance */}
          <div>
            <label
              htmlFor="txn-balance"
              className="block text-sm font-medium mb-1.5"
            >
              Balance <span className="text-destructive">*</span>
            </label>
            <input
              id="txn-balance"
              type="number"
              step="0.01"
              {...register('balance', {
                required: 'Balance is required',
              })}
              placeholder="0.00"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                errors.balance && 'border-destructive',
              )}
            />
            {errors.balance && (
              <p className="mt-1 text-xs text-destructive">
                {errors.balance.message}
              </p>
            )}
          </div>

          {/* Error */}
          {mutationError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {mutationError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={addMutation.isPending}
              className={cn(
                'flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {addMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Transaction'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
