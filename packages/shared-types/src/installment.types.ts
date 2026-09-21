import { InstallmentStatus, PaymentMode } from './enums';

export interface InstallmentSchedule {
  id: string;
  saleId: string;
  totalPrincipal: number;
  totalInterest: number;
  fileCharge: number;
  totalPayable: number;
  numInstallments: number;
  emiAmount: number;
  startDate: string;
  status: 'active' | 'completed' | 'defaulted';
  creditBalance?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Installment {
  id: string;
  scheduleId: string;
  installmentNumber: number;
  parentInstallmentNumber?: number | null;
  subSequence?: number | null;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: InstallmentStatus;
  isRescheduled: boolean;
  rescheduledFromId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstallmentPayment {
  id: string;
  installmentId: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  collectedBy?: string;
  collectorName?: string;
  referenceNumber?: string;
  notes?: string;
  createdAt: string;
}

export interface EMICalculationInput {
  sellingPrice: number;
  downPayment: number;
  interestRate: number;
  fileCharge: number;
  numInstallments: number;
}

export interface EMICalculationResult {
  principal: number;
  totalInterest: number;
  fileCharge: number;
  totalPayable: number;
  emiAmount: number;
  schedule: { installmentNumber: number; dueDate: string; amount: number }[];
}

export interface RecordPaymentRequest {
  installmentId: string;
  scenario: 'full_payment' | 'reschedule' | 'partial_reschedule';
  amountPaid?: number;
  paymentMode?: PaymentMode;
  newDate?: string;
  notes?: string;
}

export interface TenantInstallmentSettings {
  /** @deprecated Percentage-based penalty; superseded by `defaultPenaltyPerDay`. */
  defaultPenalRateMonthly: number;
  /**
   * Flat late penalty in rupees per day, per SALE — the same amount whether
   * one EMI is late or several. Used when a sale has no `penaltyPerDay` of its
   * own. Runs from the day after the oldest unpaid EMI's due date, with no
   * grace period, and is charged only when the collector ticks "apply penalty".
   */
  defaultPenaltyPerDay: number;
  /**
   * An EMI counts as "paid early" when it is fully paid at least this many days
   * before its due date. Only then is the early-payment deduction offered.
   */
  earlyPaymentMinDays: number;
  defaultPaymentAllocation: 'oldest_first' | 'manual';
  defaultThresholdDays: number;
  reliabilityWindowDays: number;
}

export const DEFAULT_TENANT_INSTALLMENT_SETTINGS: TenantInstallmentSettings = {
  defaultPenalRateMonthly: 1.0,
  defaultPenaltyPerDay: 2,
  earlyPaymentMinDays: 30,
  defaultPaymentAllocation: 'oldest_first',
  defaultThresholdDays: 60,
  reliabilityWindowDays: 365,
};

/**
 * What the collector sees before recording a payment against one EMI.
 * Both adjustments are suggestions — nothing is charged or deducted unless
 * the collector ticks the matching box.
 */
export interface PaymentPreview {
  installmentId: string;
  installmentNumber: number;
  dueDate: string;
  asOf: string;
  remainingAmount: number;
  /**
   * Every EMI on the sale that still has money owing, oldest first. Payments
   * are applied in this order unless the collector picks a specific EMI.
   */
  outstanding: Array<{
    installmentId: string;
    installmentNumber: number;
    dueDate: string;
    remainingAmount: number;
  }>;
  penalty: {
    /** Rupees per day in force for this sale (per sale, not per EMI). */
    perDay: number;
    /**
     * Due date of the oldest unpaid EMI on the sale when it is overdue —
     * how long the customer has been behind. Null when nothing is late.
     */
    overdueSince: string | null;
    /** Days not yet charged (from the later of `overdueSince` or the last charge). */
    days: number;
    amount: number;
    /** False when nothing on the sale is overdue, or every late day is already charged. */
    applicable: boolean;
    /** Penalty already charged on this sale and still active. */
    alreadyCharged: number;
  };
  earlyPayment: {
    applicable: boolean;
    daysEarly: number;
    minDaysEarly: number;
    /** This EMI's share of the interest taken at sale time. */
    amount: number;
    /** Installment number(s) the deduction would reduce, last first. */
    targetInstallmentNumbers: number[];
    /** Set when the deduction isn't offered, so the UI can say why. */
    reason?: string;
  };
}

export interface ReliabilityMetrics {
  customerId: string;
  promisesMade: number;
  promisesKept: number;
  promisesPartiallyKept: number;
  promisesBroken: number;
  promisesBrokenEmiCount: number;
  activeOverdueEmiCount: number;
  totalOutstanding: number;
  avgDpdAtPayment: number | null;
  riskBand: 'low' | 'medium' | 'high';
}

export interface PatternBRecordPaymentRequest {
  scheduleId: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  collectedBy?: string;
  referenceNumber?: string;
  notes?: string;
  explicitInstallmentId?: string;
  applyInterest?: {
    installmentId: string;
    appliedAmount: number;
    daysOverdue: number;
    notes?: string;
  };
}
