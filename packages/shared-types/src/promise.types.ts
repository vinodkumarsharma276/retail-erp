export type InstallmentPromiseStatus =
  | 'pending'
  | 'kept'
  | 'partially_kept'
  | 'broken'
  /** Customer gave a new date before this one arrived (1.1 → 1.2). */
  | 'replaced'
  /** Withdrawn by the shop, e.g. a wrong date typed in. */
  | 'cancelled';

export interface InstallmentPromiseRecord {
  id: string;
  tenantId: string;
  scheduleId: string;
  customerId: string;
  coveredInstallmentIds: string[];
  promisedDate: string;
  promisedAmount: number;
  status: InstallmentPromiseStatus;
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
  collectedAmount: number;
  notes: string | null;
  /**
   * Register-style label per covered EMI: the k-th promise on EMI N reads
   * "N.k" (first follow-up on EMI 1 is "1.1", the next "1.2"). Cancelled
   * promises don't take a number. Keyed by installment id.
   */
  labels?: Record<string, string>;
}

/**
 * One customer the collector should call on a given day, with why.
 * Per sale, because penalty and payments both work per sale.
 */
export interface CallListRow {
  scheduleId: string;
  saleId: string;
  saleNumber: string;
  ledgerNumber: string;
  customer: { id: string; name: string; phone: string; zone: string | null; city: string | null };
  product: { brand: string; modelNumber: string };
  /** Why they're on today's list, most important first. */
  reasons: Array<
    | { kind: 'due_today'; installmentNumber: number; amount: number }
    | { kind: 'promise_due'; label: string; amount: number }
    | { kind: 'promise_broken'; label: string; promisedDate: string; daysSince: number }
    | { kind: 'overdue'; oldestInstallmentNumber: number; daysLate: number }
  >;
  /** Unpaid EMIs on or before the date, oldest first. */
  dueNow: Array<{ installmentId: string; installmentNumber: number; dueDate: string; remainingAmount: number }>;
  totalDueNow: number;
  /** The first unpaid EMI falling due after the date, if any. */
  nextEmi: { installmentId: string; installmentNumber: number; dueDate: string; remainingAmount: number } | null;
  /** Promise still in the future that covers some of this sale's EMIs. */
  openPromise: { label: string; promisedDate: string; amount: number } | null;
}

export interface CallListResponse {
  date: string;
  rows: CallListRow[];
  /** Sales whose overdue EMIs are all covered by a future promise — not called today. */
  snoozed: Array<{ scheduleId: string; customerName: string; label: string; promisedDate: string; amount: number }>;
}

export interface CreateInstallmentPromiseInput {
  scheduleId: string;
  customerId: string;
  coveredInstallmentIds: string[];
  promisedDate: string;
  promisedAmount: number;
  notes?: string;
}
