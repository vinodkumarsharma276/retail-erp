import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Transfer type (frontend shape — matches API response)
// ---------------------------------------------------------------------------
export interface Transfer {
  id: string;
  productId: string;
  fromShopId: string;
  toShopId: string;
  transferPrice?: number;
  gstAmount?: number;
  invoiceNumber?: string;
  notes?: string;
  status: 'initiated' | 'in_transit' | 'received' | 'cancelled';
  initiatedBy?: string;
  receivedBy?: string;
  initiatedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  // Populated relations
  product?: {
    id: string;
    brand: string;
    modelNumber: string;
    serialNumber?: string;
    mrp: number;
    sellingPrice: number;
    purchasePrice: number;
    status: string;
  };
  fromShop?: { id: string; name: string; code: string };
  toShop?: { id: string; name: string; code: string };
  initiatedByUser?: { id: string; fullName: string; username: string };
  receivedByUser?: { id: string; fullName: string; username: string };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  transfers: (filters: TransferFilters) => ['transfers', filters] as const,
  incomingTransfers: ['transfers', 'incoming'] as const,
  transferDetail: (id: string) => ['transfers', id] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface TransferFilters {
  page?: number;
  pageSize?: number;
  fromShopId?: string;
  toShopId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ---------------------------------------------------------------------------
// Transfer list (paginated)
// ---------------------------------------------------------------------------
export function useTransfersQuery(filters: TransferFilters) {
  return useQuery({
    queryKey: keys.transfers(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.fromShopId) params.set('fromShopId', filters.fromShopId);
      if (filters.toShopId) params.set('toShopId', filters.toShopId);
      if (filters.status) params.set('status', filters.status);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);

      const { data } = await apiClient.get<PaginatedResponse<Transfer>>(
        `/transfers?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Incoming transfers (pending receipt for current shop)
// ---------------------------------------------------------------------------
export function useIncomingTransfersQuery() {
  return useQuery({
    queryKey: keys.incomingTransfers,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Transfer[]>>(
        '/transfers/incoming',
      );
      return data.data!;
    },
  });
}

// ---------------------------------------------------------------------------
// Transfer detail
// ---------------------------------------------------------------------------
export function useTransferDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.transferDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Transfer>>(
        `/transfers/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Initiate transfer
// ---------------------------------------------------------------------------
export function useInitiateTransferMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      productId: string;
      toShopId: string;
      transferPrice?: number;
      gstAmount?: number;
      invoiceNumber?: string;
      notes?: string;
    }) => {
      const { data } = await apiClient.post<ApiResponse<Transfer>>(
        '/transfers',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Receive transfer
// ---------------------------------------------------------------------------
export function useReceiveTransferMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.put<ApiResponse<Transfer>>(
        `/transfers/${id}/receive`,
      );
      return data.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({
        queryKey: keys.transferDetail(id),
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Cancel transfer
// ---------------------------------------------------------------------------
export function useCancelTransferMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.put<ApiResponse<Transfer>>(
        `/transfers/${id}/cancel`,
      );
      return data.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({
        queryKey: keys.transferDetail(id),
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
