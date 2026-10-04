export type Direction = 'debit' | 'credit';
export type ParseMethod = 'spreadsheet' | 'pdf-text' | 'ai-text' | 'ai-vision';
export type CategorySource = 'rule' | 'user-rule' | 'ai' | 'user' | 'none';
export type ReviewStatus = 'pending' | 'verified' | 'suspicious';
export type Channel = 'UPI' | 'NEFT/IMPS/RTGS' | 'Card' | 'ATM/Cash' | 'Cheque' | 'Auto-debit' | 'Bank' | 'Other';

/** A transaction as it comes out of a parser, before enrichment. */
export interface RawTransaction {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amount: number; // signed: negative = money out
  balance: number | null;
  reference?: string | null;
}

export interface ParseResult {
  transactions: RawTransaction[];
  method: ParseMethod;
  bank: string | null;
  accountHint: string | null;
  currency: string | null;
  warnings: string[];
  /** Share of rows whose running balance reconciles with the previous row (0..1), null if not checkable. */
  reconciliation: number | null;
}

export interface FlagReason {
  code: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
}

/** A transaction after enrichment, ready to be stored. */
export interface EnrichedTransaction extends RawTransaction {
  direction: Direction;
  counterparty: string | null;
  channel: Channel;
  category: string;
  categorySource: CategorySource;
  confidence: number | null;
  aiNote: string | null;
}
