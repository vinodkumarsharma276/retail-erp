import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Expense {
  id: string;
  expenseDate: string;
  category: string;
  vendorName: string;
  description: string;
  amount: number;
  gstAmount: number;
  invoiceNumber: string | null;
  isGstClaimable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSummary {
  totalExpenses: number;
  totalGstClaimable: number;
  byCategory: Array<{
    category: string;
    total: number;
    count: number;
  }>;
}

export interface ExpenseFilters {
  page?: number;
  pageSize?: number;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  expenses: (filters: ExpenseFilters) => ['expenses', filters] as const,
  expenseSummary: (dateFrom?: string, dateTo?: string) =>
    ['expenses', 'summary', { dateFrom, dateTo }] as const,
  expenseDetail: (id: string) => ['expenses', id] as const,
};

// ---------------------------------------------------------------------------
// Expense list (paginated)
// ---------------------------------------------------------------------------
export function useExpensesQuery(filters: ExpenseFilters) {
  return useQuery({
    queryKey: keys.expenses(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.category) params.set('category', filters.category);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.search) params.set('search', filters.search);

      const { data } = await apiClient.get<PaginatedResponse<Expense>>(
        `/expenses?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Expense summary (aggregated by category)
// ---------------------------------------------------------------------------
export function useExpenseSummaryQuery(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: keys.expenseSummary(dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const { data } = await apiClient.get<ApiResponse<ExpenseSummary>>(
        `/expenses/summary?${params.toString()}`,
      );
      return data.data!;
    },
  });
}

// ---------------------------------------------------------------------------
// Expense detail
// ---------------------------------------------------------------------------
export function useExpenseDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.expenseDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Expense>>(
        `/expenses/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create expense
// ---------------------------------------------------------------------------
export function useCreateExpenseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<Expense>>(
        '/expenses',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update expense
// ---------------------------------------------------------------------------
export function useUpdateExpenseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<Expense>>(
        `/expenses/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({
        queryKey: keys.expenseDetail(variables.id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete expense (admin only)
// ---------------------------------------------------------------------------
export function useDeleteExpenseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}
