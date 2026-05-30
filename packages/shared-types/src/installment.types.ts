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
  defaultPenalRateMonthly: number;
  defaultPaymentAllocation: 'oldest_first' | 'manual';
  defaultThresholdDays: number;
  reliabilityWindowDays: number;
}

export const DEFAULT_TENANT_INSTALLMENT_SETTINGS: TenantInstallmentSettings = {
  defaultPenalRateMonthly: 1.0,
  defaultPaymentAllocation: 'oldest_first',
  defaultThresholdDays: 60,
  reliabilityWindowDays: 365,
};

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
