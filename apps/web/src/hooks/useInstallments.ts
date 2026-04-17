import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  InstallmentSchedule,
  Installment,
  InstallmentPayment,
} from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  schedules: (filters: ScheduleFilters) => ['installments', 'schedules', filters] as const,
  overdue: () => ['installments', 'overdue'] as const,
  collections: (date: string) => ['installments', 'collections', date] as const,
  collectionsToday: () => ['installments', 'collections', 'today'] as const,
  scheduleDetail: (id: string) => ['installments', 'schedule', id] as const,
  scheduleTimeline: (id: string) => ['installments', 'schedule', id, 'timeline'] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface ScheduleFilters {
  page?: number;
  pageSize?: number;
  status?: string;
}

// ---------------------------------------------------------------------------
// Response types (API shapes)
// ---------------------------------------------------------------------------
export interface ScheduleListItem extends InstallmentSchedule {
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  productName: string;
  productBrand: string;
  totalPaid: number;
  totalRemaining: number;
  nextDueDate?: string;
  nextDueAmount?: number;
}

export interface OverdueInstallmentItem {
  id: string;
  scheduleId: string;
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  daysOverdue: number;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  productName: string;
  productBrand: string;
  saleId: string;
}

export interface CollectionItem {
  id: string;
  scheduleId: string;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  daysOverdue: number;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  productName: string;
  productBrand: string;
  saleId: string;
}

export interface ScheduleDetailResponse {
  schedule: InstallmentSchedule;
  installments: (Installment & {
    payments: InstallmentPayment[];
    rescheduledTo?: { id: string; installmentNumber: number; dueDate: string };
  })[];
  sale: {
    id: string;
    saleNumber: string;
    saleDate: string;
    totalAmount: number;
    downPayment: number;
    interestRate: number;
    fileCharge: number;
    emiAmount: number;
    numInstallments: number;
  };
  customer: {
    id: string;
    name: string;
    phone: string;
    customerCode: string;
    city?: string;
  };
  product: {
    id: string;
    brand: string;
    modelNumber: string;
    serialNumber?: string;
  };
}

export interface TimelineEvent {
  id: string;
  installmentNumber: number;
  type: 'installment' | 'payment' | 'reschedule';
  date: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  paymentMode?: string;
  collectedBy?: string;
  isRescheduled: boolean;
  rescheduledFromId?: string;
  rescheduledToId?: string;
  notes?: string;
  payments: InstallmentPayment[];
}

// ---------------------------------------------------------------------------
// Installment schedule list (paginated, shop-scoped)
// ---------------------------------------------------------------------------
export function useInstallmentSchedulesQuery(filters: ScheduleFilters) {
  return useQuery({
    queryKey: keys.schedules(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.status) params.set('status', filters.status);

      const { data } = await apiClient.get<PaginatedResponse<ScheduleListItem>>(
        `/installments?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Overdue installments
// ---------------------------------------------------------------------------
export function useOverdueInstallmentsQuery() {
  return useQuery({
    queryKey: keys.overdue(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<OverdueInstallmentItem[]>>(
        '/installments/overdue',
      );
      return data.data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Today's collections
// ---------------------------------------------------------------------------
export function useTodayCollectionsQuery() {
  return useQuery({
    queryKey: keys.collectionsToday(),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CollectionItem[]>>(
        '/installments/collections/today',
      );
      return data.data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Collections for a specific date
// ---------------------------------------------------------------------------
export function useCollectionsQuery(date: string) {
  return useQuery({
    queryKey: keys.collections(date),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CollectionItem[]>>(
        `/installments/collections/date/${date}`,
      );
      return data.data ?? [];
    },
    enabled: !!date,
  });
}

// ---------------------------------------------------------------------------
// Collections for a date range
// ---------------------------------------------------------------------------
export function useCollectionsRangeQuery(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['installments', 'collections-range', dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ collections: CollectionItem[]; rescheduledNotes: any[] }>>(
        `/installments/collections/range?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      );
      return data.data ?? { collections: [], rescheduledNotes: [] };
    },
    enabled: !!dateFrom && !!dateTo,
  });
}

// ---------------------------------------------------------------------------
// Schedule detail with all installments + payments
// ---------------------------------------------------------------------------
export function useScheduleDetailQuery(scheduleId: string | undefined) {
  return useQuery({
    queryKey: keys.scheduleDetail(scheduleId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ScheduleDetailResponse>>(
        `/installments/${scheduleId}`,
      );
      return data.data!;
    },
    enabled: !!scheduleId,
  });
}

// ---------------------------------------------------------------------------
// Schedule timeline
// ---------------------------------------------------------------------------
export function useScheduleTimelineQuery(scheduleId: string | undefined) {
  return useQuery({
    queryKey: keys.scheduleTimeline(scheduleId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<TimelineEvent[]>>(
        `/installments/${scheduleId}/timeline`,
      );
      return data.data ?? [];
    },
    enabled: !!scheduleId,
  });
}

// ---------------------------------------------------------------------------
// Search installment schedules
// ---------------------------------------------------------------------------
export function useInstallmentSearchQuery(query: string, filterBy: string) {
  return useQuery({
    queryKey: ['installments', 'search', query, filterBy],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<any[]>>(
        `/installments/search?q=${encodeURIComponent(query)}&filterBy=${filterBy}`,
      );
      return data.data ?? [];
    },
    enabled: query.trim().length >= 2,
  });
}

// ---------------------------------------------------------------------------
// Record installment payment (all 3 scenarios)
// ---------------------------------------------------------------------------
export function useRecordInstallmentPaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      installmentId,
      payload,
    }: {
      installmentId: string;
      payload: {
        scenario: 'full_payment' | 'reschedule' | 'partial_reschedule';
        amountPaid?: number;
        paymentMode?: string;
        newDate?: string;
        notes?: string;
      };
    }) => {
      const { data } = await apiClient.post<ApiResponse<Installment>>(
        `/installments/${installmentId}/pay`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Reschedule installment
// ---------------------------------------------------------------------------
export function useRescheduleInstallmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      installmentId,
      payload,
    }: {
      installmentId: string;
      payload: {
        newDate: string;
        notes?: string;
      };
    }) => {
      const { data } = await apiClient.post<ApiResponse<Installment>>(
        `/installments/${installmentId}/reschedule`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}
