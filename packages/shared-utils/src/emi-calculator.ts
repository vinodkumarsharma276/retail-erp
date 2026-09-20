import type { EMICalculationInput, EMICalculationResult } from '@retailerp/shared-types';

/**
 * Calculates EMI schedule for self-finance installment sales.
 *
 * Formula: Simple interest on reducing balance per month.
 * Total = Principal + (Principal * interestRate/100 * numInstallments) + fileCharge
 * EMI = Total / numInstallments
 */
export function calculateEMI(input: EMICalculationInput): EMICalculationResult {
  const { sellingPrice, downPayment, interestRate, fileCharge, numInstallments } = input;

  const principal = sellingPrice - downPayment;
  const totalInterest = principal * (interestRate / 100) * numInstallments;
  const totalPayable = principal + totalInterest + fileCharge;
  const emiAmount = Math.round(totalPayable / numInstallments);

  const schedule: EMICalculationResult['schedule'] = [];
  const today = new Date();

  for (let i = 1; i <= numInstallments; i++) {
    const dueDate = new Date(today);
    dueDate.setMonth(dueDate.getMonth() + i);
    schedule.push({
      installmentNumber: i,
      dueDate: dueDate.toISOString().split('T')[0],
      amount: emiAmount,
    });
  }

  return {
    principal,
    totalInterest,
    fileCharge,
    totalPayable,
    emiAmount,
    schedule,
  };
}

/**
 * Recalculates EMI for a different number of installments (real-time preview).
 */
export function recalculateEMIForMonths(
  input: Omit<EMICalculationInput, 'numInstallments'>,
  newMonths: number,
): EMICalculationResult {
  return calculateEMI({ ...input, numInstallments: newMonths });
}

// ---------------------------------------------------------------------------
// Final settlement quote
// ---------------------------------------------------------------------------

export interface SettlementQuoteInput {
  /** Total principal as stored on InstallmentSchedule. */
  totalPrincipal: number;
  /** Total simple interest baked into the schedule. */
  totalInterest: number;
  /** File / processing charge for the loan. */
  fileCharge: number;
  /** Original number of installments. */
  numInstallments: number;
  /** Per-installment summary. */
  installments: Array<{
    installmentNumber: number;
    amountDue: number;
    amountPaid: number;
    /** Treat as paid from the schedule's perspective. */
    status: string;
    isClosed?: boolean;
    isRescheduled?: boolean;
  }>;
}

export interface SettlementQuoteResult {
  /** Principal portion still owed (sum of unpaid principal shares). */
  unpaidPrincipal: number;
  /** File-charge portion still owed. */
  unpaidFileCharge: number;
  /** Interest portion already considered "earned" because installments were paid. */
  earnedInterest: number;
  /** Interest baked into unpaid future installments that gets waived on early closure. */
  waivedInterest: number;
  /** What the customer needs to pay today to fully close the loan. */
  finalSettlement: number;
  /** Per-installment shares so callers can persist payment splits. */
  perInstallment: {
    principalShare: number;
    interestShare: number;
    fileChargeShare: number;
    emiAmount: number;
  };
  /** How many installments are still considered unpaid. */
  unpaidCount: number;
}

/**
 * Compute an early-closure settlement quote for a self-finance schedule.
 * Treats simple-interest schedules: each installment carries an equal share
 * of principal, interest and file charge. Paid + rescheduled rows are
 * excluded from the unpaid pool. Closed (Rule C absorbed) rows are also
 * excluded — they no longer require collection.
 */
export function computeSettlementQuote(input: SettlementQuoteInput): SettlementQuoteResult {
  const n = Math.max(1, input.numInstallments);
  const principalShare = round2(input.totalPrincipal / n);
  const interestShare = round2(input.totalInterest / n);
  const fileChargeShare = round2(input.fileCharge / n);
  const emiAmount = round2(principalShare + interestShare + fileChargeShare);

  let unpaidCount = 0;
  for (const inst of input.installments) {
    if (inst.isClosed) continue;
    if (inst.isRescheduled) continue;
    if (inst.status === 'paid') continue;
    if (inst.status === 'rescheduled') continue;
    unpaidCount += 1;
  }

  const unpaidPrincipal = round2(principalShare * unpaidCount);
  const unpaidFileCharge = round2(fileChargeShare * unpaidCount);
  const waivedInterest = round2(interestShare * unpaidCount);
  const earnedInterest = round2(input.totalInterest - waivedInterest);
  const finalSettlement = round2(unpaidPrincipal + unpaidFileCharge);

  return {
    unpaidPrincipal,
    unpaidFileCharge,
    earnedInterest,
    waivedInterest,
    finalSettlement,
    perInstallment: { principalShare, interestShare, fileChargeShare, emiAmount },
    unpaidCount,
  };
}

// ---------------------------------------------------------------------------
// Overdue interest accrual
// ---------------------------------------------------------------------------

export interface AccruedInterestInput {
  /** Outstanding amount on the installment as of `asOf`. */
  remainingAmount: number;
  /** Original installment due date (Date or ISO string). */
  dueDate: Date | string;
  /** As-of date (defaults to today). */
  asOf?: Date | string;
  /** Loan's monthly interest rate in percent (e.g. 2 for 2% / month). */
  monthlyInterestRate: number;
}

export interface AccruedInterestResult {
  daysOverdue: number;
  /** Daily rate as a fraction (e.g. 0.000667 for 2%/month ÷ 30). */
  dailyRate: number;
  accruedInterest: number;
}

/**
 * Compute simple interest accrued on an overdue installment.
 * Daily rate = monthlyRate% / 30. Returns 0 accrual when not overdue.
 */
export function computeAccruedInterest(input: AccruedInterestInput): AccruedInterestResult {
  const due = input.dueDate instanceof Date ? input.dueDate : new Date(input.dueDate);
  const asOf = input.asOf
    ? input.asOf instanceof Date
      ? input.asOf
      : new Date(input.asOf)
    : new Date();
  // Normalise both to day-precision (avoid TZ shifts)
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const daysOverdue = Math.max(0, Math.floor((asOfDay - dueDay) / (1000 * 60 * 60 * 24)));
  const dailyRate = input.monthlyInterestRate / 100 / 30;
  const accruedInterest = round2(input.remainingAmount * dailyRate * daysOverdue);
  return { daysOverdue, dailyRate, accruedInterest };
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
