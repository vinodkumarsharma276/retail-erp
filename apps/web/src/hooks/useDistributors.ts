import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  Distributor,
  DistributorListItem,
  DistributorProduct,
  DistributorPayment } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  distributors: (filters: DistributorFilters) => ['distributors', filters] as const,
  distributorDetail: (id: string) => ['distributors', id] as const,
  distributorProducts: (id: string, filters: DistributorProductFilters) =>
    ['distributors', id, 'products', filters] as const,
  distributorPayments: (id: string) => ['distributors', id, 'payments'] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface DistributorFilters {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface DistributorProductFilters {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
}

// ---------------------------------------------------------------------------
// Distributor list (paginated)
// ---------------------------------------------------------------------------
export function useDistributorsQuery(filters: DistributorFilters) {
  return useQuery({
    queryKey: keys.distributors(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.search) params.set('search', filters.search);

      const { data } = await apiClient.get<PaginatedResponse<DistributorListItem>>(
        `/distributors?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Distributor detail
// ---------------------------------------------------------------------------
export function useDistributorDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.distributorDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Distributor & { categories?: Array<{ id: string; name: string }> }>>(
        `/distributors/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Distributor products (paginated)
// ---------------------------------------------------------------------------
export function useDistributorProductsQuery(
  id: string | undefined,
  filters: DistributorProductFilters,
) {
  return useQuery({
    queryKey: keys.distributorProducts(id ?? '', filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);

      const { data } = await apiClient.get<PaginatedResponse<DistributorProduct>>(
        `/distributors/${id}/products?${params.toString()}`,
      );
      return data;
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Distributor payments
// ---------------------------------------------------------------------------
export function useDistributorPaymentsQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.distributorPayments(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<DistributorPayment[]>>(
        `/distributors/${id}/payments`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create distributor
// ---------------------------------------------------------------------------
export function useCreateDistributorMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<Distributor>>(
        '/distributors',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Record lumpsum payment to distributor
// ---------------------------------------------------------------------------
export interface LumpsumPaymentPayload {
  amount: number;
  paymentMode: string;
  paymentDate: string;
  referenceNumber?: string;
  notes?: string;
}

export interface LumpsumPaymentResult {
  totalDistributed: number;
  invoicesPaidFull: number;
  invoicesPaidPartial: number;
  remainingAmount: number;
}

export function useRecordDistributorPaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: LumpsumPaymentPayload;
    }) => {
      const { data } = await apiClient.post<ApiResponse<LumpsumPaymentResult>>(
        `/distributors/${id}/payments`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      queryClient.invalidateQueries({
        queryKey: keys.distributorDetail(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: keys.distributorPayments(variables.id),
      });
      // Also invalidate purchases since payment statuses change
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update distributor
// ---------------------------------------------------------------------------
export function useUpdateDistributorMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<Distributor>>(
        `/distributors/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      queryClient.invalidateQueries({
        queryKey: keys.distributorDetail(variables.id),
      });
    },
  });
}
