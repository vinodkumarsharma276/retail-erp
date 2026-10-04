import { describe, expect, it } from 'vitest';
import { computeEarlyPaymentDeduction, computeLatePenalty } from '@retailerp/shared-utils';

/**
 * A — Late penalty: ₹ per day, per SALE, from the oldest unpaid EMI's due
 * date to the payment date. Only days not already charged count.
 */
describe('A. Late penalty calculation', () => {
  it('A1 nothing is charged when no EMI is overdue', () => {
    expect(computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: null, asOf: '2026-10-04', chargedThrough: null }).amount).toBe(0);
  });

  it('A2 nothing is charged when paid on the due date', () => {
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-10-04', asOf: '2026-10-04', chargedThrough: null });
    expect(p).toMatchObject({ days: 0, amount: 0 });
  });

  it('A3 nothing is charged when paid before the due date', () => {
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-10-10', asOf: '2026-10-04', chargedThrough: null });
    expect(p.amount).toBe(0);
  });

  it('A4 due 1 Aug, paid 10 Aug → 9 days late → ₹18 (days after the due date)', () => {
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-08-01', asOf: '2026-08-10', chargedThrough: null });
    expect(p).toMatchObject({ days: 9, amount: 18 });
  });

  it('A5 one month late at ₹2/day → ₹60', () => {
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-09-04', asOf: '2026-10-04', chargedThrough: null });
    expect(p).toMatchObject({ days: 30, amount: 60 });
  });

  it('A6 counts from the OLDEST unpaid EMI only — several late EMIs still cost ₹2/day, not ₹2 each', () => {
    // The caller passes only the oldest unpaid due date; there is no per-EMI multiplier.
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-08-04', asOf: '2026-10-04', chargedThrough: null });
    expect(p).toMatchObject({ days: 61, amount: 122 });
  });

  it('A7 only days after the last charge are counted', () => {
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-08-04', asOf: '2026-10-04', chargedThrough: '2026-09-24' });
    expect(p).toMatchObject({ days: 10, amount: 20 });
  });

  it('A8 an old charge from before the current overdue EMI does not extend the clock back', () => {
    const p = computeLatePenalty({ perDay: 2, oldestUnpaidDueDate: '2026-09-04', asOf: '2026-10-04', chargedThrough: '2026-08-20' });
    expect(p).toMatchObject({ days: 30, amount: 60 });
  });

  it('A9 a per-sale rate is used as given (₹5/day × 30 = ₹150)', () => {
    expect(computeLatePenalty({ perDay: 5, oldestUnpaidDueDate: '2026-09-04', asOf: '2026-10-04', chargedThrough: null }).amount).toBe(150);
  });

  it('A10 a rate of ₹0 charges nothing', () => {
    expect(computeLatePenalty({ perDay: 0, oldestUnpaidDueDate: '2026-08-01', asOf: '2026-10-04', chargedThrough: null }).amount).toBe(0);
  });
});

/**
 * B — Early-payment deduction: an EMI paid in full at least 30 days before
 * its due date may get its share of the sale-time interest knocked off the
 * last EMI. Always the collector's choice.
 */
describe('B. Early-payment deduction calculation', () => {
  const base = { minDaysEarly: 30, totalInterest: 1200, numInstallments: 4 };

  it('B1 37 days early → eligible for this EMI\'s share of interest (₹1,200 ÷ 4 = ₹300)', () => {
    expect(computeEarlyPaymentDeduction({ ...base, dueDate: '2026-11-10', paymentDate: '2026-10-04' })).toEqual({
      eligible: true,
      daysEarly: 37,
      amount: 300,
    });
  });

  it('B2 exactly 30 days early → eligible', () => {
    expect(computeEarlyPaymentDeduction({ ...base, dueDate: '2026-11-03', paymentDate: '2026-10-04' }).eligible).toBe(true);
  });

  it('B3 29 days early → not eligible', () => {
    expect(computeEarlyPaymentDeduction({ ...base, dueDate: '2026-11-02', paymentDate: '2026-10-04' }).eligible).toBe(false);
  });

  it('B4 paid late → not eligible, days early shown as 0', () => {
    expect(computeEarlyPaymentDeduction({ ...base, dueDate: '2026-09-04', paymentDate: '2026-10-04' })).toMatchObject({
      eligible: false,
      daysEarly: 0,
    });
  });

  it('B5 a sale with no interest has nothing to deduct', () => {
    expect(
      computeEarlyPaymentDeduction({ ...base, totalInterest: 0, dueDate: '2026-12-10', paymentDate: '2026-10-04' }),
    ).toMatchObject({ eligible: false, amount: 0 });
  });
});
