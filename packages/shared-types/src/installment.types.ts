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
