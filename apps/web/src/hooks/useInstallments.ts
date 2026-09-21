import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  InstallmentSchedule,
  Installment,
  InstallmentPayment,
  InstallmentPromiseRecord,
  CreateInstallmentPromiseInput,
  PaymentPreview,
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
  scheduleRollLog: (id: string) => ['installments', 'schedule', id, 'roll-log'] as const,
  promises: (filters: { scheduleId?: string; customerId?: string; status?: string }) => ['installment-promises', filters] as const,
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
  parentInstallmentNumber?: number | null;
  subSequence?: number | null;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  daysOverdue: number;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerZone?: string | null;
  productName: string;
  productBrand: string;
  saleId: string;
  saleNumber?: string;
  ledgerNumber?: string;
  shop?: { id: string; name: string; code: string } | null;
}

export interface CollectionItem {
  id: string;
  scheduleId: string;
  installmentNumber: number;
  parentInstallmentNumber?: number | null;
  subSequence?: number | null;
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
  customerZone?: string | null;
  productName: string;
  productBrand: string;
  saleId: string;
  saleNumber?: string;
  ledgerNumber?: string;
  shop?: { id: string; name: string; code: string } | null;
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
    /** ₹/day late penalty in force — the sale's own rate or the shop default. */
    effectivePenaltyPerDay: number;
    /** True when the sale has no rate of its own and uses the shop default. */
    penaltyPerDayIsDefault: boolean;
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
  parentInstallmentNumber?: number | null;
  subSequence?: number | null;
  isClosed?: boolean;
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
export function useOverdueInstallmentsQuery(zone?: string) {
  return useQuery({
    queryKey: [...keys.overdue(), zone ?? null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (zone) params.set('zone', zone);
      const qs = params.toString();
      const { data } = await apiClient.get<ApiResponse<OverdueInstallmentItem[]>>(
        `/installments/overdue${qs ? '?' + qs : ''}`,
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
export function useCollectionsRangeQuery(dateFrom: string, dateTo: string, zone?: string) {
  return useQuery({
    queryKey: ['installments', 'collections-range', dateFrom, dateTo, zone ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (zone) params.set('zone', zone);
      const { data } = await apiClient.get<ApiResponse<{ collections: CollectionItem[]; rescheduledNotes: any[] }>>(
        `/installments/collections/range?${params.toString()}`,
      );
      return data.data ?? { collections: [], rescheduledNotes: [] };
    },
    enabled: !!dateFrom && !!dateTo,
  });
}

// ---------------------------------------------------------------------------
// Paid installments within a date range (by due-date)
// ---------------------------------------------------------------------------
export interface PaidCollectionItem extends CollectionItem {
  firstPaymentDate: string | null;
  lastPaymentDate: string | null;
  daysFromDue: number | null;
  paymentCount: number;
  saleNumber: string;
  ledgerNumber: string;
}

export function usePaidCollectionsRangeQuery(dateFrom: string, dateTo: string, zone?: string) {
  return useQuery({
    queryKey: ['installments', 'paid-range', dateFrom, dateTo, zone ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (zone) params.set('zone', zone);
      const { data } = await apiClient.get<ApiResponse<{ collections: PaidCollectionItem[] }>>(
        `/installments/collections/paid-range?${params.toString()}`,
      );
      return data.data?.collections ?? [];
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
// Schedule roll log (audit trail of rolling-overdue engine events)
// ---------------------------------------------------------------------------
export interface RollLogEvent {
  id: string;
  scheduleId: string;
  installmentId: string | null;
  eventType:
    | 'installment_due'
    | 'sub_created'
    | 'payment_recorded'
    | 'partial_payment'
    | 'chain_absorbed'
    | 'chain_closed_manual'
    | 'schedule_completed'
    | 'rescheduled'
    | 'reschedule_undone'
    | 'redistributed'
    | 'payment_reverted'
    | 'payment_moved'
    | 'early_collection_scheduled'
    | 'note_added';
  eventDate: string;
  displayMessage: string;
  metadata: Record<string, unknown> | null;
  actorUserId: string | null;
  actor?: { id: string; fullName: string; username: string } | null;
  createdAt: string;
}

export function useScheduleRollLogQuery(scheduleId: string | undefined) {
  return useQuery({
    queryKey: keys.scheduleRollLog(scheduleId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<RollLogEvent[]>>(
        `/installments/${scheduleId}/roll-log`,
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
        scenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
        amount?: number;
        amountPaid?: number;
        paymentMode?: string;
        paymentBreakdown?: Array<{ mode: string; amount: number }>;
        paymentDate?: string;
        explicitInstallmentId?: string;
        newDate?: string;
        notes?: string;
        /** Legacy caller-supplied penalty amount. Prefer `applyPenalty`. */
        applyInterest?: { installmentId?: string; amount?: number; appliedAmount?: number; daysOverdue?: number; notes?: string };
        /** Charge the late penalty; the server computes it from the sale's ₹/day rate. */
        applyPenalty?: boolean;
        /** Give the early-payment deduction off the last installment. */
        applyEarlyPaymentDeduction?: boolean;
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

/**
 * Late penalty the collector may charge and early-payment deduction they may
 * give, for one EMI on a given payment date. Nothing is applied by reading it.
 */
export function usePaymentPreviewQuery(installmentId: string | undefined, paymentDate: string | undefined) {
  return useQuery({
    queryKey: ['installments', 'payment-preview', installmentId, paymentDate],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<PaymentPreview>>(
        `/installments/${installmentId}/payment-preview`,
        { params: paymentDate ? { paymentDate } : undefined },
      );
      return data.data!;
    },
    enabled: !!installmentId,
    staleTime: 15_000,
  });
}

/** Change the ₹/day late-penalty rate on an existing sale. */
export function useUpdatePenaltyPerDayMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ scheduleId, penaltyPerDay }: { scheduleId: string; penaltyPerDay: number }) => {
      const { data } = await apiClient.patch<ApiResponse<{ saleId: string; penaltyPerDay: number }>>(
        `/installments/schedules/${scheduleId}/penalty-per-day`,
        { penaltyPerDay },
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

export function useInstallmentPromisesQuery(filters: { scheduleId?: string; customerId?: string; status?: string }) {
  return useQuery({
    queryKey: keys.promises(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.scheduleId) params.set('scheduleId', filters.scheduleId);
      if (filters.customerId) params.set('customerId', filters.customerId);
      if (filters.status) params.set('status', filters.status);
      const { data } = await apiClient.get<ApiResponse<InstallmentPromiseRecord[]>>(
        `/promises?${params.toString()}`,
      );
      return data.data ?? [];
    },
    enabled: !!filters.scheduleId || !!filters.customerId,
  });
}

export function useCreateInstallmentPromiseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateInstallmentPromiseInput) => {
      const { data } = await apiClient.post<ApiResponse<InstallmentPromiseRecord>>('/promises', payload);
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installment-promises'] });
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
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

// ---------------------------------------------------------------------------
// Revert (undo) a payment
// ---------------------------------------------------------------------------
export function useRevertPaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      paymentId,
      reason,
      applyInterest,
      cascade,
    }: {
      paymentId: string;
      reason: string;
      applyInterest?: { amount: number; notes?: string };
      cascade?: boolean;
    }) => {
      const { data } = await apiClient.post(
        `/installments/payments/${paymentId}/revert`,
        { reason, applyInterest, cascade },
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Undo a reschedule — preview + mutation
// ---------------------------------------------------------------------------
export interface UndoReschedulePreviewIneligible {
  eligible: false;
  reason: string;
}

export interface UndoReschedulePreviewSubRow {
  eligible: true;
  branch: 'sub_row';
  subRowId: string;
  subRowLabel: string;
  amount: number;
  newDueDate: string;
  sourceId: string;
  sourceLabel: string;
  sourceDueDate: string;
  rescheduledAt: string | null;
  rescheduledBy: string | null;
}

export interface UndoReschedulePreviewRedistribute {
  eligible: true;
  branch: 'redistribute';
  restoresPrimaryNumber: number;
  carryover: number;
  promisedDate: string | null;
  targets: Array<{
    id: string;
    installmentNumber: number;
    currentAmountDue: number;
    currentRemaining: number;
    delta: number;
    newAmountDue: number;
    newRemaining: number;
    eligible: boolean;
  }>;
  redistLogId: string;
  rescheduledAt: string | null;
  rescheduledBy: string | null;
}

export type UndoReschedulePreview =
  | UndoReschedulePreviewIneligible
  | UndoReschedulePreviewSubRow
  | UndoReschedulePreviewRedistribute;

export function useUndoReschedulePreviewQuery(
  installmentId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['installments', 'undo-reschedule-preview', installmentId],
    enabled: !!installmentId && enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<UndoReschedulePreview>>(
        `/installments/${installmentId}/undo-reschedule/preview`,
      );
      return data.data!;
    },
  });
}

export function useUndoRescheduleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      installmentId,
      reason,
    }: {
      installmentId: string;
      reason: string;
    }) => {
      const { data } = await apiClient.post(
        `/installments/${installmentId}/undo-reschedule`,
        { reason },
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Final settlement (early closure) — quote + record
// ---------------------------------------------------------------------------
export interface SettlementQuote {
  scheduleId: string;
  saleId: string;
  saleNumber: string;
  totalPrincipal: number;
  totalInterest: number;
  fileCharge: number;
  numInstallments: number;
  unpaidPrincipal: number;
  unpaidFileCharge: number;
  earnedInterest: number;
  waivedInterest: number;
  finalSettlement: number;
  unpaidCount: number;
  perInstallment: {
    principalShare: number;
    interestShare: number;
    fileChargeShare: number;
    emiAmount: number;
  };
  asOf: string;
}

export function useSettlementQuoteQuery(scheduleId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['installments', 'settlement-quote', scheduleId],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<SettlementQuote>>(
        `/installments/schedules/${scheduleId}/settlement-quote`,
      );
      return data.data!;
    },
    enabled: !!scheduleId && enabled,
    staleTime: 60_000,
  });
}

export function useRecordFinalSettlementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      scheduleId,
      payload,
    }: {
      scheduleId: string;
      payload: {
        paymentMode: string;
        paymentDate?: string;
        referenceNumber?: string;
        notes?: string;
        expectedAmount?: number;
      };
    }) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(
        `/installments/schedules/${scheduleId}/final-settlement`,
        payload,
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Overdue interest accrual + apply / rollback
// ---------------------------------------------------------------------------
export interface InterestAccrualItem {
  installmentId: string;
  installmentNumber: number;
  parentInstallmentNumber: number | null;
  subSequence: number | null;
  dueDate: string;
  remainingAmount: number;
  status: string;
  daysOverdue: number;
  suggestedInterest: number;
  appliedInterest: number;
  applications: Array<{
    id: string;
    appliedAmount: number;
    appliedAt: string;
    appliedBy: string;
    notes: string | null;
  }>;
}

export function useInterestAccrualQuery(scheduleId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['installments', 'interest-accrual', scheduleId],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<InterestAccrualItem[]>>(
        `/installments/schedules/${scheduleId}/interest-accrual`,
      );
      return data.data ?? [];
    },
    enabled: !!scheduleId && enabled,
    staleTime: 30_000,
  });
}

export function useApplyOverdueInterestMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      installmentId,
      payload,
    }: {
      installmentId: string;
      payload: { amount: number; notes?: string };
    }) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(
        `/installments/${installmentId}/apply-interest`,
        payload,
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

export function useRollbackInterestApplicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      reason,
    }: {
      applicationId: string;
      reason: string;
    }) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(
        `/installments/interest-applications/${applicationId}/rollback`,
        { reason },
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Correct a payment recorded with the wrong (higher) amount.
// Shortfall is distributed equally to upcoming installments.
// ---------------------------------------------------------------------------
export function useCorrectPaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      paymentId,
      correctAmount,
      reason,
      applyInterest,
    }: {
      paymentId: string;
      correctAmount: number;
      reason: string;
      applyInterest?: { amount: number; notes?: string };
    }) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(
        `/installments/payments/${paymentId}/correct`,
        { correctAmount, reason, applyInterest },
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}
// the wrong installment to the correct one.
// ---------------------------------------------------------------------------
export function useMovePaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      paymentId,
      targetInstallmentId,
      reason,
      paymentDate,
      applyInterestOnTarget,
    }: {
      paymentId: string;
      targetInstallmentId: string;
      reason: string;
      paymentDate?: string;
      applyInterestOnTarget?: { amount: number; notes?: string };
    }) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(
        `/installments/payments/${paymentId}/move`,
        { targetInstallmentId, reason, paymentDate, applyInterestOnTarget },
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}
