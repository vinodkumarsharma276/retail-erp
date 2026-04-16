import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  Customer,
} from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  customers: (filters: CustomerFilters) => ['customers', filters] as const,
  customerSearch: (query: string) => ['customers', 'search', query] as const,
  customerDetail: (id: string) => ['customers', id] as const,
  customerSales: (id: string) => ['customers', id, 'sales'] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface CustomerFilters {
  page?: number;
  pageSize?: number;
  search?: string;
}

// ---------------------------------------------------------------------------
// Customer list (paginated, shop-scoped)
// ---------------------------------------------------------------------------
export function useCustomersQuery(filters: CustomerFilters) {
  return useQuery({
    queryKey: keys.customers(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.search) params.set('search', filters.search);

      const { data } = await apiClient.get<PaginatedResponse<Customer>>(
        `/customers?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Customer quick search (across all shops, min 2 chars)
// ---------------------------------------------------------------------------
export function useCustomerSearchQuery(query: string) {
  return useQuery({
    queryKey: keys.customerSearch(query),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Customer[]>>(
        `/customers/search?query=${encodeURIComponent(query)}`,
      );
      return data.data!;
    },
    enabled: query.length >= 2,
  });
}

// ---------------------------------------------------------------------------
// Customer detail (with guarantor + sales)
// ---------------------------------------------------------------------------
export function useCustomerDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.customerDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CustomerDetailResponse>>(
        `/customers/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Customer sales
// ---------------------------------------------------------------------------
export function useCustomerSalesQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.customerSales(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CustomerSaleItem[]>>(
        `/customers/${id}/sales`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create customer
// ---------------------------------------------------------------------------
export function useCreateCustomerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<Customer>>(
        '/customers',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update customer
// ---------------------------------------------------------------------------
export function useUpdateCustomerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<Customer>>(
        `/customers/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({
        queryKey: keys.customerDetail(variables.id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Extended types (API response shapes)
// ---------------------------------------------------------------------------
export interface CustomerDetailResponse extends Customer {
  guarantor?: Customer;
  guaranteedCustomers?: Customer[];
}

export interface CustomerSaleItem {
  id: string;
  saleNumber: string;
  saleDate: string;
  saleType: string;
  totalAmount: number;
  paymentMode: string;
  productBrand?: string;
  productModel?: string;
  status?: string;
}
