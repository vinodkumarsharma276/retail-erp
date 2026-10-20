import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  Purchase,
  RecordPurchasePaymentRequest,
  PurchasePayment,
  PurchaseImportRequest,
  PurchaseImportPreview,
  PurchaseImportResult,
  PurchaseImportBatchSummary,
  ClassifyItemsRequest,
  ClassifyItemsResponse,
  ForgetClassificationsRequest,
  ForgetClassificationsResponse,
  LookupItemRequest,
  LookupItemResponse,
  SaveClassificationsRequest,
  UnbilledType,
  UnbilledSeriesState,
  StartUnbilledSeriesRequest,
  CreateUnbilledPurchaseRequest,
} from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  purchases: (filters: PurchaseFilters) => ['purchases', filters] as const,
  purchaseDetail: (id: string) => ['purchases', id] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface PurchaseFilters {
  page?: number;
  pageSize?: number;
  distributorId?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: string;
  allShops?: boolean;
  search?: string;
  /** 'manual' or 'excel_import' — where the purchase came from. */
  source?: string;
}

// ---------------------------------------------------------------------------
// Purchase list (paginated)
// ---------------------------------------------------------------------------
export function usePurchasesQuery(filters: PurchaseFilters) {
  return useQuery({
    queryKey: keys.purchases(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.distributorId) params.set('distributorId', filters.distributorId);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.paymentStatus) params.set('paymentStatus', filters.paymentStatus);
      if (filters.allShops) params.set('allShops', 'true');
      if (filters.search?.trim()) params.set('search', filters.search.trim());
      if (filters.source) params.set('source', filters.source);

      const { data } = await apiClient.get<PaginatedResponse<Purchase>>(
        `/purchases?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Purchase detail
// ---------------------------------------------------------------------------
export function usePurchaseDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.purchaseDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Purchase>>(
        `/purchases/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create purchase
// ---------------------------------------------------------------------------
export function useCreatePurchaseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<Purchase>>(
        '/purchases',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Purchases made without a bill
// ---------------------------------------------------------------------------
/**
 * The product types bought without a bill, each with the invoice number its
 * next purchase would take.
 *
 * Never cached across the screen's lifetime: the number on offer moves the
 * moment anybody records one of these, so a stale FURN7 would be wrong.
 */
export function useUnbilledTypesQuery(enabled = true) {
  return useQuery({
    queryKey: ['purchases', 'unbilled-types'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<UnbilledType[]>>('/purchases/unbilled-types');
      return data.data ?? [];
    },
    enabled,
    staleTime: 0,
  });
}

/** Set where a type's numbering starts, for a type nobody has numbered yet. */
export function useStartUnbilledSeriesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: StartUnbilledSeriesRequest) => {
      const { data } = await apiClient.put<ApiResponse<UnbilledSeriesState>>('/purchases/unbilled-series', payload);
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases', 'unbilled-types'] });
    },
  });
}

/**
 * Record a purchase made without a bill.
 *
 * The invoice number is not sent — it is issued as the purchase saves — so
 * the returned purchase is the only thing that says what it became.
 */
export function useCreateUnbilledPurchaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateUnbilledPurchaseRequest) => {
      const { data } = await apiClient.post<ApiResponse<Purchase>>('/purchases/unbilled', payload);
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update purchase
// ---------------------------------------------------------------------------
export function useUpdatePurchaseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<Purchase>>(
        `/purchases/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({
        queryKey: keys.purchaseDetail(variables.id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------
export function useRecordPurchasePaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      purchaseId,
      payload,
    }: {
      purchaseId: string;
      payload: RecordPurchasePaymentRequest;
    }) => {
      const { data } = await apiClient.post<ApiResponse<PurchasePayment>>(
        `/purchases/${purchaseId}/payments`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({
        queryKey: keys.purchaseDetail(variables.purchaseId),
      });
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Bulk import from a spreadsheet
// ---------------------------------------------------------------------------
/** Check mapped sheet rows on the server. Nothing is saved. */
export function usePurchaseImportPreviewMutation() {
  return useMutation({
    mutationFn: async (payload: PurchaseImportRequest) => {
      const { data } = await apiClient.post<ApiResponse<PurchaseImportPreview>>('/purchases/import/preview', payload, {
        timeout: 120_000,
      });
      return data.data!;
    },
  });
}

/** Save every invoice that passed the check. */
export function usePurchaseImportCommitMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PurchaseImportRequest) => {
      const { data } = await apiClient.post<ApiResponse<PurchaseImportResult>>('/purchases/import', payload, {
        timeout: 600_000,
      });
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/**
 * Work out what each item name on the sheet is.
 *
 * A Tally register gives no category, brand or colour — only the shop's own
 * shorthand in one cell — so this runs before the preview. Names already
 * identified on an earlier import are answered from the server store.
 */
/**
 * Identifying the item names is a read, so it is a query rather than a
 * mutation: the answer is cacheable, and a query survives the remount React
 * StrictMode performs in development. Firing a mutation from an effect does
 * not — the first pass sends the request, the simulated remount drops its
 * result, and the screen waits for an answer that already arrived.
 *
 * `refreshToken` is part of the key: raising it asks the model again for
 * names that are already stored.
 */
export function useClassifyItemsQuery(
  names: string[],
  options?: { enabled?: boolean; refreshToken?: number; forceReask?: boolean },
) {
  const refreshToken = options?.refreshToken ?? 0;
  const forceReask = Boolean(options?.forceReask);
  return useQuery({
    queryKey: ['purchases', 'classify', names, refreshToken, forceReask] as const,
    queryFn: async () => {
      // Only an explicit "identify all again" re-asks about names already
      // answered. Raising the token alone just re-runs the step, so names
      // settled earlier come straight back from the store and only the
      // unresolved ones cost a call.
      const payload: ClassifyItemsRequest = { names, refresh: forceReask };
      const { data } = await apiClient.post<ApiResponse<ClassifyItemsResponse>>('/purchases/import/classify', payload, {
        timeout: 300_000,
      });
      return data.data!;
    },
    enabled: (options?.enabled ?? true) && names.length > 0,
    // The sheet does not change while the screen is open, and a re-ask costs
    // real money, so never refetch on its own.
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch one product’s details from the web.
 *
 * Fired from a button, never from an effect — a mutation in an effect does
 * not survive the remount React StrictMode performs in development.
 */
export function useLookupItemMutation() {
  return useMutation({
    mutationFn: async (payload: LookupItemRequest) => {
      const { data } = await apiClient.post<ApiResponse<LookupItemResponse>>('/purchases/import/lookup', payload, {
        timeout: 180_000,
      });
      return data.data!;
    },
  });
}

/**
 * Forget stored answers, so those names are worked out again.
 *
 * The store is what makes a repeat import instant, but it also keeps
 * serving a wrong answer. This is how one gets dropped.
 */
export function useForgetClassificationsMutation() {
  return useMutation({
    mutationFn: async (payload: ForgetClassificationsRequest) => {
      const { data } = await apiClient.delete<ApiResponse<ForgetClassificationsResponse>>('/purchases/import/classifications', {
        data: payload,
      });
      return data.data!;
    },
  });
}

/** Keep a correction made in the preview, so it holds for later imports. */
export function useSaveClassificationsMutation() {
  return useMutation({
    mutationFn: async (payload: SaveClassificationsRequest) => {
      const { data } = await apiClient.put<ApiResponse<{ saved: number }>>('/purchases/import/classifications', payload);
      return data.data!;
    },
  });
}

/** Past import runs. */
export function usePurchaseImportBatchesQuery(enabled = true) {
  return useQuery({
    queryKey: ['purchases', 'import-batches'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<PurchaseImportBatchSummary[]>>('/purchases/import/batches');
      return data.data ?? [];
    },
    enabled,
  });
}

/**
 * Delete purchases, and the units they brought in.
 *
 * One id or many go the same way, so a row deleted on its own and a batch
 * ticked off share this. The server refuses outright if anything has been
 * sold or moved, and says which purchase and why.
 */
export function useDeletePurchasesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data } = await apiClient.post<ApiResponse<{ purchases: number; units: number }>>(
        '/purchases/delete',
        { ids },
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
