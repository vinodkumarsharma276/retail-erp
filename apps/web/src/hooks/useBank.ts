import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: string;
  openingBalance: number;
  currentBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  transactionDate: string;
  description: string;
  referenceNumber: string | null;
  type: 'credit' | 'debit';
  amount: number;
  balance: number;
  reconciliationStatus: string;
  reconciledWithType: string | null;
  reconciledWithId: string | null;
  manualNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedMatch {
  type: string;
  referenceId: string;
  reference: string;
  date: string;
  amount: number;
  description: string;
  confidence: number;
}

export interface BankTransactionFilters {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  reconciliationStatus?: string;
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  bankAccounts: () => ['bank', 'accounts'] as const,
  bankTransactions: (accountId: string, filters: BankTransactionFilters) =>
    ['bank', 'transactions', accountId, filters] as const,
  unmatchedTransactions: () => ['bank', 'transactions', 'unmatched'] as const,
  suggestedMatches: (transactionId: string) =>
    ['bank', 'transactions', transactionId, 'suggestions'] as const,
};

// ---------------------------------------------------------------------------
// Bank accounts list
// ---------------------------------------------------------------------------
export function useBankAccountsQuery() {
  return useQuery({
    queryKey: keys.bankAccounts(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<BankAccount[]>>(
        '/bank/accounts',
      );
      return data.data!;
    },
  });
}

// ---------------------------------------------------------------------------
// Create bank account
// ---------------------------------------------------------------------------
export function useCreateBankAccountMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      bankName: string;
      accountNumber: string;
      ifscCode: string;
      accountType: string;
      openingBalance: number;
    }) => {
      const { data } = await apiClient.post<ApiResponse<BankAccount>>(
        '/bank/accounts',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank', 'accounts'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Bank transactions (paginated)
// ---------------------------------------------------------------------------
export function useBankTransactionsQuery(
  accountId: string | undefined,
  filters: BankTransactionFilters,
) {
  return useQuery({
    queryKey: keys.bankTransactions(accountId ?? '', filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.reconciliationStatus)
        params.set('reconciliationStatus', filters.reconciliationStatus);

      const { data } = await apiClient.get<PaginatedResponse<BankTransaction>>(
        `/bank/accounts/${accountId}/transactions?${params.toString()}`,
      );
      return data;
    },
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Add single transaction
// ---------------------------------------------------------------------------
export function useAddBankTransactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accountId,
      payload,
    }: {
      accountId: string;
      payload: {
        transactionDate: string;
        description: string;
        referenceNumber?: string;
        type: string;
        amount: number;
        balance: number;
      };
    }) => {
      const { data } = await apiClient.post<ApiResponse<BankTransaction>>(
        `/bank/accounts/${accountId}/transactions`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Bulk import transactions
// ---------------------------------------------------------------------------
export function useBulkImportTransactionsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accountId,
      transactions,
    }: {
      accountId: string;
      transactions: Array<{
        transactionDate: string;
        description: string;
        referenceNumber?: string;
        type: string;
        amount: number;
        balance: number;
      }>;
    }) => {
      const { data } = await apiClient.post<ApiResponse<BulkImportResult>>(
        `/bank/accounts/${accountId}/upload-statement`,
        { transactions },
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Unmatched transactions
// ---------------------------------------------------------------------------
export function useUnmatchedTransactionsQuery() {
  return useQuery({
    queryKey: keys.unmatchedTransactions(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<BankTransaction[]>>(
        '/bank/transactions/unmatched',
      );
      return data.data!;
    },
  });
}

// ---------------------------------------------------------------------------
// Suggested matches for reconciliation
// ---------------------------------------------------------------------------
export function useSuggestedMatchesQuery(transactionId: string | undefined) {
  return useQuery({
    queryKey: keys.suggestedMatches(transactionId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<SuggestedMatch[]>>(
        `/bank/transactions/${transactionId}/suggestions`,
      );
      return data.data!;
    },
    enabled: !!transactionId,
  });
}

// ---------------------------------------------------------------------------
// Reconcile transaction (auto-match)
// ---------------------------------------------------------------------------
export function useReconcileTransactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      transactionId,
      reconciledWithType,
      reconciledWithId,
    }: {
      transactionId: string;
      reconciledWithType: string;
      reconciledWithId: string;
    }) => {
      const { data } = await apiClient.put<ApiResponse<BankTransaction>>(
        `/bank/transactions/${transactionId}/reconcile`,
        { reconciledWithType, reconciledWithId },
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Manual reconcile
// ---------------------------------------------------------------------------
export function useManualReconcileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      transactionId,
      notes,
    }: {
      transactionId: string;
      notes: string;
    }) => {
      const { data } = await apiClient.put<ApiResponse<BankTransaction>>(
        `/bank/transactions/${transactionId}/manual-reconcile`,
        { notes },
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank'] });
    },
  });
}
