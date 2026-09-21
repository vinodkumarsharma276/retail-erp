import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiResponse, PaymentMode } from '@retailerp/shared-types';
import apiClient from '../lib/api-client';

// ------------------------------------------------------------------
// Types for API responses (matching the service layer output shapes)
// ------------------------------------------------------------------

export interface CollectionCustomer {
  id: string;
  name: string;
  phone: string;
  customerCode: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pincode?: string;
}

export interface CollectionProduct {
  id: string;
  brand: string;
  modelNumber: string;
  serialNumber?: string;
  category: { id: string; name: string };
}

export interface CollectionGuarantor {
  id: string;
  name: string;
  phone: string;
}

export interface CollectionSchedule {
  id: string;
  emiAmount: number;
  numInstallments: number;
  totalPayable: number;
  sale: {
    id: string;
    saleNumber: string;
    ledgerNumber: string;
    saleDate: string;
    totalAmount: number;
    downPayment: number;
    customer: CollectionCustomer;
    product: CollectionProduct;
    guarantor?: CollectionGuarantor | null;
  };
  collectionAssigns: Array<{
    employee: { id: string; fullName: string; username: string };
  }>;
}

export interface CollectionItem {
  id: string;
  scheduleId: string;
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  isRescheduled: boolean;
  notes?: string;
  schedule: CollectionSchedule;
  payments: Array<{
    id: string;
    amount: number;
    paymentMode: string;
    paymentDate: string;
  }>;
  rescheduledFrom?: {
    id: string;
    installmentNumber: number;
    dueDate: string;
    amountDue: number;
    notes?: string;
  } | null;
}

export interface CollectionsResponse {
  collections: CollectionItem[];
  rescheduledNotes: unknown[];
}

// ------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------

/** Fetch today's collection list */
export function useTodayCollectionsQuery() {
  return useQuery<CollectionsResponse>({
    queryKey: ['collections', 'today'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CollectionsResponse>>(
        '/installments/collections/today',
      );
      return response.data.data!;
    },
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60 * 2, // auto-refresh every 2 minutes
  });
}

/** Fetch collections for a specific date (YYYY-MM-DD) */
export function useCollectionsForDateQuery(date: string | null) {
  return useQuery<CollectionsResponse>({
    queryKey: ['collections', 'date', date],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CollectionsResponse>>(
        `/installments/collections/date/${date}`,
      );
      return response.data.data!;
    },
    enabled: !!date,
    staleTime: 1000 * 60, // 1 minute
  });
}

/** Fetch full installment schedule detail */
export function useScheduleDetailQuery(scheduleId: string | null) {
  return useQuery({
    queryKey: ['schedule', scheduleId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse>(
        `/installments/${scheduleId}`,
      );
      return response.data.data;
    },
    enabled: !!scheduleId,
  });
}

/** Fetch sale detail */
export function useSaleDetailQuery(saleId: string | null) {
  return useQuery({
    queryKey: ['sale', saleId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse>(`/sales/${saleId}`);
      return response.data.data;
    },
    enabled: !!saleId,
  });
}

// ------------------------------------------------------------------
// Mutations
// ------------------------------------------------------------------

interface RecordPaymentInput {
  installmentId: string;
  scenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
  amount?: number;
  amountPaid?: number;
  paymentMode?: PaymentMode;
  paymentDate?: string;
  newDate?: string;
  notes?: string;
  /** Legacy caller-supplied penalty amount. Prefer `applyPenalty`. */
  applyInterest?: { amount: number; notes?: string };
  /** Charge the late penalty; the server computes it from the sale's ₹/day rate. */
  applyPenalty?: boolean;
  /** Give the early-payment deduction off the last installment. */
  applyEarlyPaymentDeduction?: boolean;
}

export function useRecordPaymentMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordPaymentInput) => {
      const { installmentId, ...body } = input;
      const response = await apiClient.post(
        `/installments/${installmentId}/pay`,
        body,
      );
      return response.data.data;
    },
    onSuccess: () => {
      // Invalidate collection lists so they reflect the payment
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
}
