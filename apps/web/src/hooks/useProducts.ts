import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  ProductCategory,
  CategoryAttribute,
  Product,
  ProductAuditTrailEntry,
} from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  categories: ['categories'] as const,
  categoryAttributes: (id: string) => ['categories', id, 'attributes'] as const,
  products: (filters: ProductFilters) => ['products', filters] as const,
  productSearch: (query: string) => ['products', 'search', query] as const,
  productDetail: (id: string) => ['products', id] as const,
  productHistory: (id: string) => ['products', id, 'history'] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface ProductFilters {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  status?: string;
  brand?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Category tree
// ---------------------------------------------------------------------------
export function useCategoryTreeQuery() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ProductCategory[]>>(
        '/categories',
      );
      return data.data!;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes — categories rarely change
  });
}

// ---------------------------------------------------------------------------
// Category attributes (dynamic fields)
// ---------------------------------------------------------------------------
export function useCategoryAttributesQuery(categoryId: string | undefined) {
  return useQuery({
    queryKey: keys.categoryAttributes(categoryId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CategoryAttribute[]>>(
        `/categories/${categoryId}/attributes`,
      );
      return data.data!;
    },
    enabled: !!categoryId,
    staleTime: 30 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Product list (paginated, filterable)
// ---------------------------------------------------------------------------
export function useProductsQuery(filters: ProductFilters) {
  return useQuery({
    queryKey: keys.products(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.categoryId) params.set('categoryId', filters.categoryId);
      if (filters.status) params.set('status', filters.status);
      if (filters.brand) params.set('brand', filters.brand);
      if (filters.search) params.set('search', filters.search);

      const { data } = await apiClient.get<PaginatedResponse<Product>>(
        `/products?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Product global search (3+ chars)
// ---------------------------------------------------------------------------
export function useProductSearchQuery(query: string) {
  return useQuery({
    queryKey: keys.productSearch(query),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Product[]>>(
        `/products/search?query=${encodeURIComponent(query)}`,
      );
      return data.data!;
    },
    enabled: query.length >= 3,
  });
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------
export function useProductDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.productDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Product>>(
        `/products/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Product audit trail / history
// ---------------------------------------------------------------------------
export function useProductHistoryQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.productHistory(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ProductAuditTrailEntry[]>>(
        `/products/${id}/history`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create product
// ---------------------------------------------------------------------------
export function useCreateProductMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<Product>>(
        '/products',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update product
// ---------------------------------------------------------------------------
export function useUpdateProductMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<Product>>(
        `/products/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({
        queryKey: keys.productDetail(variables.id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Category CRUD mutations
// ---------------------------------------------------------------------------
export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      name: string;
      parentId?: string;
      icon?: string;
      hsnCode?: string;
      displayOrder?: number;
    }) => {
      const { data } = await apiClient.post<ApiResponse<ProductCategory>>(
        '/categories',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.categories });
    },
  });
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: { name?: string; icon?: string; hsnCode?: string; displayOrder?: number; isActive?: boolean };
    }) => {
      const { data } = await apiClient.put<ApiResponse<ProductCategory>>(
        `/categories/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.categories });
    },
  });
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.categories });
    },
  });
}

// ---------------------------------------------------------------------------
// Category attribute mutations
// ---------------------------------------------------------------------------
export function useCreateCategoryAttributeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      categoryId,
      payload,
    }: {
      categoryId: string;
      payload: {
        attributeName: string;
        attributeLabel: string;
        attributeType: string;
        isRequired?: boolean;
        options?: unknown[];
        displayOrder?: number;
      };
    }) => {
      const { data } = await apiClient.post<ApiResponse<CategoryAttribute>>(
        `/categories/${categoryId}/attributes`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: keys.categoryAttributes(variables.categoryId),
      });
    },
  });
}

export function useUpdateCategoryAttributeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      categoryId,
      attrId,
      payload,
    }: {
      categoryId: string;
      attrId: string;
      payload: Partial<{
        attributeName: string;
        attributeLabel: string;
        attributeType: string;
        isRequired: boolean;
        options: unknown[];
        displayOrder: number;
        isActive: boolean;
      }>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<CategoryAttribute>>(
        `/categories/${categoryId}/attributes/${attrId}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: keys.categoryAttributes(variables.categoryId),
      });
    },
  });
}

export function useDeleteCategoryAttributeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      categoryId,
      attrId,
    }: {
      categoryId: string;
      attrId: string;
    }) => {
      await apiClient.delete(`/categories/${categoryId}/attributes/${attrId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: keys.categoryAttributes(variables.categoryId),
      });
    },
  });
}
