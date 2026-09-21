/**
 * Collection-time money rules for self-finance EMIs.
 *
 * These are the single source of truth for the two discretionary adjustments
 * a collector can make when recording a payment. The API uses them to decide
 * what to write; the web and mobile apps show the same numbers before the
 * collector confirms. Neither rule ever applies itself — the caller decides.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(value: Date | string): number {
  const d = value instanceof Date ? value : new Date(value);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Late penalty
// ---------------------------------------------------------------------------

export interface LatePenaltyInput {
  /** Rupees per day for this sale. */
  perDay: number;
  /**
   * Due date of the OLDEST EMI on this sale that still has money owing, or
   * null when nothing is owed. The penalty clock runs from here.
   */
  oldestUnpaidDueDate: Date | string | null;
  /** Date the penalty is being worked out for — the payment date, or today. */
  asOf: Date | string;
  /**
   * Last day already covered by an earlier penalty charge on this sale.
   * Charging again only covers the days after it, so a customer is never
   * charged twice for the same day.
   */
  chargedThrough?: Date | string | null;
}

export interface LatePenaltyResult {
  perDay: number;
  days: number;
  amount: number;
  /** The date the uncharged period starts from, or null when nothing is late. */
  from: Date | null;
}

/**
 * Flat per-day late penalty for ONE SALE.
 *
 * The sale accrues `perDay` for every day it has at least one overdue EMI —
 * ₹2 a day whether one EMI is late or three. The clock starts the day after
 * the oldest unpaid EMI's due date (5 Oct due, paid 20 Oct is 15 days), with
 * no grace period. It never depends on how much is owed, so there is never
 * penalty on penalty.
 */
export function computeLatePenalty(input: LatePenaltyInput): LatePenaltyResult {
  const perDay = Math.max(0, Number(input.perDay) || 0);
  if (!input.oldestUnpaidDueDate || perDay === 0) {
    return { perDay, days: 0, amount: 0, from: null };
  }

  const due = toUtcDay(input.oldestUnpaidDueDate);
  const covered = input.chargedThrough ? toUtcDay(input.chargedThrough) : null;
  const start = covered !== null && covered > due ? covered : due;
  const days = Math.max(0, Math.floor((toUtcDay(input.asOf) - start) / DAY_MS));

  return { perDay, days, amount: round2(perDay * days), from: days > 0 ? new Date(start) : null };
}

// ---------------------------------------------------------------------------
// Early-payment deduction
// ---------------------------------------------------------------------------

export interface EarlyPaymentInput {
  dueDate: Date | string;
  paymentDate: Date | string;
  /** Minimum days ahead of the due date for the payment to count as early. */
  minDaysEarly: number;
  /** Interest fixed at the time of sale for the whole loan. */
  totalInterest: number;
  numInstallments: number;
}

export interface EarlyPaymentResult {
  eligible: boolean;
  daysEarly: number;
  /** This EMI's share of the sale-time interest — what would be deducted. */
  amount: number;
}

/**
 * The deduction a collector may offer when an EMI is paid well ahead of time.
 *
 * Interest is fixed when the sale is made and spread evenly across the EMIs,
 * so each EMI carries `totalInterest / numInstallments` of it. Paying an EMI a
 * full cycle early means the shop no longer carries that month, so that share
 * is what may be deducted — taken off the customer's last installment rather
 * than the EMI being paid, so the schedule simply ends cheaper.
 *
 * File charge is never part of the deduction.
 */
export function computeEarlyPaymentDeduction(input: EarlyPaymentInput): EarlyPaymentResult {
  const daysEarly = Math.floor((toUtcDay(input.dueDate) - toUtcDay(input.paymentDate)) / DAY_MS);
  const n = Math.max(1, input.numInstallments);
  const amount = round2(Math.max(0, input.totalInterest) / n);
  return {
    eligible: daysEarly >= input.minDaysEarly && amount > 0,
    daysEarly: Math.max(0, daysEarly),
    amount,
  };
}
