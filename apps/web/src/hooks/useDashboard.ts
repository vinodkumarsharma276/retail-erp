import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Response types (match API shapes)
// ---------------------------------------------------------------------------
export interface SalesGraphPoint {
  date: string;
  totalAmount: number;
  count: number;
}

export interface TopProductItem {
  productId: string;
  brand: string;
  modelNumber: string;
  categoryName: string;
  count: number;
  totalRevenue: number;
}

export interface YoYComparisonData {
  lastYear: { dateFrom: string; dateTo: string; products: YoYProductItem[] } | YoYProductItem[];
  thisYear: { dateFrom: string; dateTo: string; products: YoYProductItem[] } | YoYProductItem[];
}

export interface YoYProductItem {
  productId: string;
  brand: string;
  modelNumber: string;
  categoryName: string;
  count: number;
  totalRevenue: number;
}

export interface OverdueInstallmentDashItem {
  installmentId: string;
  scheduleId: string;
  customerName: string;
  customerPhone: string;
  productName: string;
  installmentNumber: number;
  amountDue: number;
  dueDate: string;
  daysOverdue: number;
}

export interface DashboardSummary {
  totalSalesThisMonth: number;
  salesChangePercent: number;
  pendingInstallments: {
    count: number;
    totalAmount: number;
  };
  stockValue: number;
  todaysCollections: {
    expected: number;
    collected: number;
  };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  summary: () => ['dashboard', 'summary'] as const,
  salesGraph: (dateFrom: string, dateTo: string) =>
    ['dashboard', 'sales-graph', dateFrom, dateTo] as const,
  topProducts: (dateFrom: string, dateTo: string, limit?: number) =>
    ['dashboard', 'top-products', dateFrom, dateTo, limit] as const,
  yoyComparison: (dateFrom: string, dateTo: string) =>
    ['dashboard', 'yoy-comparison', dateFrom, dateTo] as const,
  overdueInstallments: (dateFrom?: string, dateTo?: string) =>
    ['dashboard', 'overdue-installments', dateFrom, dateTo] as const,
};

// ---------------------------------------------------------------------------
// Dashboard summary (real-time, short cache)
// ---------------------------------------------------------------------------
export function useDashboardSummaryQuery() {
  return useQuery({
    queryKey: keys.summary(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<DashboardSummary>>(
        '/dashboard/summary',
      );
      return data.data!;
    },
    staleTime: 0,
    refetchInterval: 60_000, // refresh every minute
  });
}

// ---------------------------------------------------------------------------
// Sales graph data
// ---------------------------------------------------------------------------
export function useSalesGraphQuery(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: keys.salesGraph(dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      const { data } = await apiClient.get<ApiResponse<SalesGraphPoint[]>>(
        `/dashboard/sales-graph?${params.toString()}`,
      );
      return data.data ?? [];
    },
    enabled: !!dateFrom && !!dateTo,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Top products sold
// ---------------------------------------------------------------------------
export function useTopProductsQuery(dateFrom: string, dateTo: string, limit?: number) {
  return useQuery({
    queryKey: keys.topProducts(dateFrom, dateTo, limit),
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (limit) params.set('limit', String(limit));
      const { data } = await apiClient.get<ApiResponse<TopProductItem[]>>(
        `/dashboard/top-products?${params.toString()}`,
      );
      return data.data ?? [];
    },
    enabled: !!dateFrom && !!dateTo,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Year-over-Year comparison
// ---------------------------------------------------------------------------
export function useYoYComparisonQuery(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: keys.yoyComparison(dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      const { data } = await apiClient.get<ApiResponse<YoYComparisonData>>(
        `/dashboard/yoy-comparison?${params.toString()}`,
      );
      return data.data!;
    },
    enabled: !!dateFrom && !!dateTo,
    staleTime: 10 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Overdue installments (dashboard view)
// ---------------------------------------------------------------------------
export function useOverdueInstallmentsQuery(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: keys.overdueInstallments(dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const qs = params.toString();
      const { data } = await apiClient.get<ApiResponse<OverdueInstallmentDashItem[]>>(
        `/dashboard/overdue-installments${qs ? `?${qs}` : ''}`,
      );
      return data.data ?? [];
    },
    staleTime: 60_000,
  });
}
