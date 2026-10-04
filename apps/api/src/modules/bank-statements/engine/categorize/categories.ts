/**
 * Category taxonomy. Each category belongs to one of seven fixed groups so charts
 * can colour by a stable entity (the group) rather than by rank.
 */
export type GroupId = 'living' | 'lifestyle' | 'business' | 'finance' | 'transfers' | 'cash' | 'income' | 'other';

export interface CategoryDef {
  name: string;
  group: GroupId;
  /** Direction the category normally applies to; 'any' categories can be either. */
  kind: 'expense' | 'income' | 'any';
}

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'living', label: 'Living & essentials' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'business', label: 'Business operations' },
  { id: 'finance', label: 'Loans, tax & finance' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'cash', label: 'Cash' },
  { id: 'income', label: 'Income' },
  { id: 'other', label: 'Uncategorized' },
];

export const CATEGORIES: CategoryDef[] = [
  // Income
  { name: 'Salary & Payroll Income', group: 'income', kind: 'income' },
  { name: 'Business Income', group: 'income', kind: 'income' },
  { name: 'Interest & Dividends', group: 'income', kind: 'income' },
  { name: 'Refunds & Reversals', group: 'income', kind: 'income' },
  // Living
  { name: 'Groceries', group: 'living', kind: 'expense' },
  { name: 'Rent & Housing', group: 'living', kind: 'expense' },
  { name: 'Utilities & Bills', group: 'living', kind: 'expense' },
  { name: 'Healthcare', group: 'living', kind: 'expense' },
  { name: 'Education', group: 'living', kind: 'expense' },
  { name: 'Fuel', group: 'living', kind: 'expense' },
  // Lifestyle
  { name: 'Food & Dining', group: 'lifestyle', kind: 'expense' },
  { name: 'Shopping', group: 'lifestyle', kind: 'expense' },
  { name: 'Travel & Transport', group: 'lifestyle', kind: 'expense' },
  { name: 'Entertainment & Subscriptions', group: 'lifestyle', kind: 'expense' },
  // Business
  { name: 'Vendor & Supplier Payments', group: 'business', kind: 'expense' },
  { name: 'Payroll & Salaries Paid', group: 'business', kind: 'expense' },
  { name: 'Software & SaaS', group: 'business', kind: 'expense' },
  { name: 'Professional Services', group: 'business', kind: 'expense' },
  { name: 'Marketing & Advertising', group: 'business', kind: 'expense' },
  { name: 'Office & Supplies', group: 'business', kind: 'expense' },
  // Finance
  { name: 'Loan & EMI', group: 'finance', kind: 'expense' },
  { name: 'Credit Card Payment', group: 'finance', kind: 'expense' },
  { name: 'Investments', group: 'finance', kind: 'any' },
  { name: 'Insurance', group: 'finance', kind: 'expense' },
  { name: 'Taxes & Government', group: 'finance', kind: 'expense' },
  { name: 'Bank Charges & Fees', group: 'finance', kind: 'expense' },
  // Transfers
  { name: 'Personal Transfers', group: 'transfers', kind: 'any' },
  { name: 'Self Transfer', group: 'transfers', kind: 'any' },
  // Cash
  { name: 'Cash Withdrawal', group: 'cash', kind: 'expense' },
  { name: 'Cash Deposit', group: 'cash', kind: 'income' },
  // Fallback
  { name: 'Uncategorized', group: 'other', kind: 'any' },
];

export const UNCATEGORIZED = 'Uncategorized';
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
const byName = new Map(CATEGORIES.map((c) => [c.name.toLowerCase(), c]));

export function groupOf(category: string): GroupId {
  return byName.get(category.toLowerCase())?.group ?? 'other';
}

export function normalizeCategory(name: string | null | undefined): string {
  if (!name) return UNCATEGORIZED;
  return byName.get(name.trim().toLowerCase())?.name ?? UNCATEGORIZED;
}
