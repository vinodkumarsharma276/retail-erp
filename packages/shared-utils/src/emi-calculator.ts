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
