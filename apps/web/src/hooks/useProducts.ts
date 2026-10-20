import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  ProductCategory,
  CategoryAttribute,
  Product,
  ProductAuditTrailEntry,
  ProductEnrichResult,
  ProductEnrichBatchRequest,
  ProductEnrichBatchResult,
  ProductEnrichBatchStatus,
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
  enrichBatch: (batchId: string) => ['products', 'enrich-batch', batchId] as const,
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
  dateFrom?: string;
  dateTo?: string;
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
    // Short stale window — admins occasionally edit category attributes
    // (add/remove fields, change required) and changes should appear on
    // next page mount without waiting half an hour.
    staleTime: 60 * 1000,
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
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);

      const { data } = await apiClient.get<PaginatedResponse<Product>>(
        `/products?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Product list grouped by (shop, category, brand, model, status) with qty
// ---------------------------------------------------------------------------
export interface ProductGroupRow {
  shopId: string;
  shop: { id: string; name: string; code: string } | null;
  categoryId: string;
  category: { id: string; name: string; slug: string; path: string } | null;
  brand: string;
  modelNumber: string;
  status: string;
  quantity: number;
  /** Units of this group still missing something, by what is missing. */
  needsAttention?: { model: number; price: number; specs: number };
  mrpMin: string | null;
  mrpMax: string | null;
  purchasePriceMin: string | null;
  purchasePriceMax: string | null;
  oldestPurchase: string | null;
  latestPurchase: string | null;
}

export function useProductsGroupedQuery(filters: ProductFilters) {
  return useQuery({
    queryKey: ['products', 'grouped', filters] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.categoryId) params.set('categoryId', filters.categoryId);
      if (filters.status) params.set('status', filters.status);
      if (filters.brand) params.set('brand', filters.brand);
      if (filters.search) params.set('search', filters.search);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      const { data } = await apiClient.get<PaginatedResponse<ProductGroupRow>>(
        `/products/grouped?${params.toString()}`,
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
// Fetch product details from the web
// ---------------------------------------------------------------------------
/**
 * Look a product's missing specifications up on the web.
 *
 * Mostly for units that came off a spreadsheet: a purchase register carries
 * cost and nothing else, so they arrive with every category field empty.
 * Only empty fields are filled, and no price is written — an MRP found on
 * the web comes back as a suggestion to confirm by hand.
 */
export function useEnrichProductMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<ProductEnrichResult>>(
        `/products/${id}/enrich`,
        {},
        { timeout: 180_000 },
      );
      return data.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: keys.productDetail(id) });
    },
  });
}

/** How many models of an import run still have no specifications. */
export function useEnrichBatchStatusQuery(batchId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.enrichBatch(batchId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ProductEnrichBatchStatus>>(
        `/products/enrich/batch/${batchId}`,
      );
      return data.data!;
    },
    enabled: !!batchId && enabled,
  });
}

/**
 * One pass of the web lookup over an import run.
 *
 * A month's register can name 200 models, far too many for a single request,
 * so the caller asks for a few at a time and repeats until nothing is left.
 * Each pass only fills what is still blank, so stopping part-way costs
 * nothing and starting again picks up where it stopped.
 */
export function useEnrichBatchMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      batchId,
      ...payload
    }: ProductEnrichBatchRequest & { batchId: string }) => {
      const { data } = await apiClient.post<ApiResponse<ProductEnrichBatchResult>>(
        `/products/enrich/batch/${batchId}`,
        payload,
        { timeout: 600_000 },
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: keys.enrichBatch(variables.batchId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Category CRUD mutations
// ---------------------------------------------------------------------------
/** "Sewing Machine" becomes "sewing-machine", the slug shape the API expects. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      name: string;
      /** Derived from the name when not given; the server requires one. */
      slug?: string;
      parentId?: string | null;
      isLeaf?: boolean;
      icon?: string;
      hsnCode?: string;
      displayOrder?: number;
      /** How goods of this type are bought; billed unless said otherwise. */
      purchaseModes?: 'billed' | 'unbilled' | 'both';
    }) => {
      const { data } = await apiClient.post<ApiResponse<ProductCategory>>('/categories', {
        ...payload,
        slug: payload.slug ?? slugify(payload.name),
      });
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
