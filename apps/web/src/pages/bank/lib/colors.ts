import type { GroupId } from './api';

/**
 * Colour follows the entity, never its rank: every group / channel / source owns a fixed slot.
 * Slot values live in CSS variables so light & dark steps swap in one place.
 */
export const SLOT = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)'] as const;
export const OTHER = 'var(--chart-other)';

export const GROUP_COLOR: Record<GroupId, string> = {
  living: SLOT[0],
  lifestyle: SLOT[1],
  business: SLOT[2],
  finance: SLOT[3],
  transfers: SLOT[4],
  cash: SLOT[5],
  income: SLOT[6],
  other: OTHER,
};

export const CHANNEL_COLOR: Record<string, string> = {
  UPI: SLOT[0],
  'NEFT/IMPS/RTGS': SLOT[1],
  Card: SLOT[2],
  'ATM/Cash': SLOT[3],
  Cheque: SLOT[4],
  'Auto-debit': SLOT[5],
  Bank: SLOT[6],
  Other: OTHER,
};

/** Money-in sources (credit categories) — fixed order. */
export const INCOME_COLOR: Record<string, string> = {
  'Business Income': SLOT[0],
  'Cash Deposit': SLOT[1],
  'Personal Transfers': SLOT[2],
  'Refunds & Reversals': SLOT[3],
  'Interest & Dividends': SLOT[4],
  'Salary & Payroll Income': SLOT[5],
  'Self Transfer': SLOT[6],
};

/** Inflow / outflow are a fixed two-series pair everywhere. */
export const FLOW = { inflow: SLOT[0], outflow: SLOT[1] };

export const SHOP_COLOR = (index: number) => SLOT[index % SLOT.length];
