import type { RawTransaction } from '../../engine/types.js';

export interface FeedAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string | null;
}

export interface CredentialField {
  key: string;
  label: string;
  /** Secret values are never sent back to the browser once saved. */
  secret: boolean;
  placeholder?: string;
}

/**
 * A source of bank transactions over an API. Implementations return raw rows
 * (signed amount, running balance); categorising, de-duplicating and storing is
 * the shared import pipeline's job.
 */
export interface FeedProvider {
  id: string;
  label: string;
  /** Banks this provider serves (matched against the registered account's bank name). */
  banks: string[] | 'any';
  /** False until the bank's API contract is implemented; the UI shows it as unavailable. */
  ready: boolean;
  /** Shown when `ready` is false, or as setup help. */
  note: string;
  credentialFields: CredentialField[];
  /** Transactions dated `from`..`to` inclusive (ISO dates), oldest first. */
  fetchTransactions(account: FeedAccount, credentials: Record<string, string>, from: string, to: string): Promise<RawTransaction[]>;
}

export class FeedNotReadyError extends Error {}
