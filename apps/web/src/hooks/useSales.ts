import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  SaleRecord,
  Installment,
  InstallmentSchedule,
} from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  sales: (filters: SaleFilters) => ['sales', filters] as const,
  saleDetail: (id: string) => ['sales', id] as const,
  saleInstallments: (id: string) => ['sales', id, 'installments'] as const,
  saleActivity: (id: string) => ['sales', id, 'activity'] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface SaleFilters {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  saleType?: string;
  customerSearch?: string;
  /** Filter to sales whose net-profit % is at most this value (inclusive). */
  maxProfitPct?: number;
  /** Filter to sales whose net-profit % is at least this value (inclusive). */
  minProfitPct?: number;
  /** Filter by approval state. Used by the "Approve" view. */
  approvalStatus?: 'pending' | 'approved';
}

// ---------------------------------------------------------------------------
// Sale list (paginated, shop-scoped)
// "Others" role gets sanitized data from the API automatically
// ---------------------------------------------------------------------------
export function useSalesQuery(filters: SaleFilters) {
  return useQuery({
    queryKey: keys.sales(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.saleType) params.set('saleType', filters.saleType);
      if (filters.customerSearch) params.set('customerSearch', filters.customerSearch);
      if (filters.maxProfitPct !== undefined) params.set('maxProfitPct', String(filters.maxProfitPct));
      if (filters.minProfitPct !== undefined) params.set('minProfitPct', String(filters.minProfitPct));
      if (filters.approvalStatus) params.set('approvalStatus', filters.approvalStatus);

      const { data } = await apiClient.get<PaginatedResponse<SaleListItem>>(
        `/sales?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Pending-approval count — drives the badge subscript on the "Approve" button.
// Returns 0 in single-shop mode if there's nothing pending in this shop.
// ---------------------------------------------------------------------------
export function usePendingApprovalCountQuery(enabled = true) {
  return useQuery({
    queryKey: ['sales', 'pending-approval-count'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ count: number }>>(
        '/sales/pending-approval/count',
      );
      return data.data?.count ?? 0;
    },
    enabled,
    refetchInterval: 60_000, // poll every minute so the badge stays fresh
  });
}

// ---------------------------------------------------------------------------
// Approve a pending sale — flips approvalStatus to 'approved' and stamps
// the approver/approvedAt fields.
// ---------------------------------------------------------------------------
export function useApproveSaleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (saleId: string) => {
      const { data } = await apiClient.post<ApiResponse<SaleRecord>>(
        `/sales/${saleId}/approve`,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Sale detail
// "Others" role gets sanitized version from the API
// ---------------------------------------------------------------------------
export function useSaleDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.saleDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<SaleDetailResponse>>(
        `/sales/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Sale installments (admin/accountant only)
// ---------------------------------------------------------------------------
export function useSaleInstallmentsQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.saleInstallments(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<SaleInstallmentsResponse>>(
        `/sales/${id}/installments`,
      );
      return data.data!;
    },
    enabled: !!id && enabled,
  });
}

// ---------------------------------------------------------------------------
// Sale activity / audit log
// ---------------------------------------------------------------------------
export interface SaleActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; username: string; fullName: string | null } | null;
}

export function useSaleActivityQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.saleActivity(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<SaleActivityEntry[]>>(
        `/sales/${id}/activity`,
      );
      return data.data ?? [];
    },
    enabled: !!id && enabled,
  });
}

// ---------------------------------------------------------------------------
// Create sale
// ---------------------------------------------------------------------------
export function useCreateSaleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<SaleRecord>>(
        '/sales',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update sale
// ---------------------------------------------------------------------------
export function useUpdateSaleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId, payload }: { saleId: string; payload: Record<string, unknown> }) => {
      const { data } = await apiClient.put<ApiResponse<SaleRecord>>(
        `/sales/${saleId}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: keys.saleDetail(variables.saleId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Record finance company payment
// ---------------------------------------------------------------------------
export function useRecordFinancePaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      saleId,
      payload,
    }: {
      saleId: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<SaleRecord>>(
        `/sales/${saleId}/finance-payment`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({
        queryKey: keys.saleDetail(variables.saleId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Record pending payment (partial_with_promise or any sale with pendingAmount > 0)
// ---------------------------------------------------------------------------
export function useRecordPendingPaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId, data }: { saleId: string; data: { amount: number; paymentMode: string; paymentBreakdown?: Array<{mode: string; amount: number}> | null; notes?: string } }) => {
      const res = await apiClient.put(`/sales/${saleId}/record-payment`, data);
      return res.data.data;
    },
    onSuccess: (_data: unknown, variables: { saleId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({
        queryKey: keys.saleDetail(variables.saleId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Extended types (API response shapes)
// ---------------------------------------------------------------------------
export interface SaleListItem {
  id: string;
  saleNumber: string;
  ledgerNumber: string;
  saleDate: string;
  saleType: string;
  totalAmount: number;
  paymentMode: string;
  pendingAmount: number;
  financePaymentStatus?: string;
  completedAt?: string | null;
  approvalStatus?: 'pending' | 'approved';
  approvedById?: string | null;
  approvedAt?: string | null;
  createdBy: string;
  // Joined data
  customerName?: string;
  customerPhone?: string;
  customerCode?: string;
  productBrand?: string;
  productModel?: string;
  productSerialNumber?: string;
  // Shop (always populated by the API; useful in "All Shops" mode)
  shop?: {
    id: string;
    name: string;
    code: string;
  };
}

export interface SaleDetailResponse extends SaleRecord {
  customer?: {
    id: string;
    customerCode: string;
    name: string;
    phone: string;
    altPhone?: string;
    aadhaarNumber?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    customerType?: 'individual' | 'business';
    businessName?: string | null;
    gstNumber?: string | null;
  };
  product?: {
    id: string;
    brand: string;
    modelNumber: string;
    serialNumber?: string;
    categoryId: string;
    sellingPrice: number;
    mrp: number;
    purchasePrice: number;
    dynamicAttributes?: Record<string, unknown> | null;
  };
  guarantor?: {
    id: string;
    customerCode: string;
    name: string;
    phone: string;
  };
  financeCompany?: {
    id: string;
    name: string;
    code: string;
  };
}

export interface SaleInstallmentsResponse {
  schedule: InstallmentSchedule;
  installments: Installment[];
}
