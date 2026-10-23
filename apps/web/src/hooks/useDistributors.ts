import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  Distributor,
  DistributorListItem,
  DistributorProduct,
  DistributorPayment } from '@retailerp/shared-types';
import type { ParsedCreditor } from '@retailerp/shared-utils';

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

/**
 * The supplier a purchase was started against, named in the URL by the
 * distributor pages so the wizard can open with it already chosen.
 *
 * Shaped as a list item because that is what the purchase wizards hold. A
 * detail record carries no purchase aggregates, and the wizards never read
 * them, so they start at zero exactly as they do for a supplier created from
 * inside the wizard.
 *
 * A missing or unreadable id resolves to no supplier and the wizard then just
 * asks for one — a stale link is not worth an error screen.
 */
export function usePresetDistributor(id: string | undefined) {
  const query = useDistributorDetailQuery(id);

  const distributor: DistributorListItem | null = query.data
    ? {
        ...query.data,
        totalProductsPurchased: 0,
        totalPaymentPaid: 0,
        pendingPayment: 0,
      }
    : null;

  return { distributor, isLoading: !!id && query.isLoading };
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

/**
 * Delete distributors. One id or many go the same way, so a single-row
 * delete and a tick-several-off delete share this.
 *
 * The API refuses the whole batch if any of them has traded, so nothing is
 * half-deleted and the error names the supplier that stopped it.
 */
export interface DeleteDistributorsResult {
  distributors: number;
  /** Only when the invoices and stock went too. */
  purchases?: number;
  units?: number;
}

export function useDeleteDistributorsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { ids: string[]; cascade?: boolean }) => {
      const { data } = await apiClient.post<ApiResponse<DeleteDistributorsResult>>(
        '/distributors/delete',
        vars,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export interface DistributorImportPlanRow {
  rowNumber: number;
  companyName: string;
  action: 'create' | 'fill' | 'unchanged';
  matchedId?: string;
  matchedName?: string;
  matchedBy?: 'gst' | 'name';
  fills?: string[];
  gstNumber: string | null;
  city: string;
  phone: string;
}

export interface DistributorImportPreview {
  rows: DistributorImportPlanRow[];
  counts: { create: number; fill: number; unchanged: number };
}

/** What a creditors sheet would do. Writes nothing. */
export function useDistributorImportPreview() {
  return useMutation({
    mutationFn: async (rows: ParsedCreditor[]) => {
      const { data } = await apiClient.post<ApiResponse<DistributorImportPreview>>(
        '/distributors/import/preview',
        { rows },
      );
      return data.data!;
    },
  });
}

export interface DistributorImportResult {
  created: number;
  filled: number;
  unchanged: number;
}

export function useDistributorImportMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rows: ParsedCreditor[]) => {
      const { data } = await apiClient.post<ApiResponse<DistributorImportResult>>(
        '/distributors/import',
        { rows },
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
    },
  });
}

export interface DistributorDeletionImpact {
  id: string;
  companyName: string;
  purchases: number;
  products: number;
}

/**
 * What deleting these suppliers would destroy, asked before confirming.
 *
 * A count the browser already has would be a guess — the list only knows
 * products, not invoices, and both move. This comes from the same rows the
 * delete will act on.
 */
export function useDistributorDeletionImpact() {
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data } = await apiClient.post<ApiResponse<DistributorDeletionImpact[]>>(
        '/distributors/deletion-impact',
        { ids },
      );
      return data.data!;
    },
  });
}

export interface MergeDistributorsResult {
  keptName: string;
  merged: number;
  purchases: number;
  products: number;
  categories: number;
}

/**
 * Fold duplicate suppliers into the one being kept, moving their purchases
 * and stock across first.
 *
 * Purchases and products change hands, so anything that counts them is now
 * wrong until refetched — hence the wider invalidation than a plain delete.
 */
export function useMergeDistributorsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { sourceIds: string[]; targetId: string }) => {
      const { data } = await apiClient.post<ApiResponse<MergeDistributorsResult>>(
        '/distributors/merge',
        vars,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
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
