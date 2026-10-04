import axios from 'axios';
import { apiClient } from '../../../lib/api-client';

export type Direction = 'debit' | 'credit';
export type ReviewStatus = 'pending' | 'verified' | 'suspicious';
export type GroupId = 'living' | 'lifestyle' | 'business' | 'finance' | 'transfers' | 'cash' | 'income' | 'other';

export interface Shop {
  id: string;
  name: string;
  code: string;
}
export interface Category {
  name: string;
  group: GroupId;
  kind: 'expense' | 'income' | 'any';
}
export interface Settings {
  largeAmount: number;
  cashAlertAmount: number;
  unknownPayeeAmount: number;
  minAiConfidence: number;
  baseCurrency: string;
}
export interface Meta {
  shops: Shop[];
  categories: Category[];
  groups: { id: GroupId; label: string }[];
  ai: { enabled: boolean; model: string };
  supportedExtensions: string[];
  maxFileMb: number;
  settings: Settings;
}
export interface FlagReason {
  code: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
}
export interface Transaction {
  id: string;
  statement_id: string;
  shop_id: string;
  shop_name: string;
  bank: string;
  date: string;
  description: string;
  amount: number;
  direction: Direction;
  balance: number | null;
  reference: string | null;
  counterparty: string | null;
  channel: string;
  category: string;
  group: GroupId;
  category_source: 'rule' | 'user-rule' | 'ai' | 'user' | 'none';
  confidence: number | null;
  ai_note: string | null;
  flagged: boolean;
  flag_reasons: FlagReason[];
  review_status: ReviewStatus | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  file_name: string;
}
export interface TxPage {
  rows: Transaction[];
  total: number;
  inflow: number;
  outflow: number;
  page: number;
  pageSize: number;
}
export interface Statement {
  id: string;
  shop_id: string;
  shop_name: string;
  file_name: string;
  file_type: string;
  file_size: number;
  bank: string;
  account_hint: string | null;
  currency: string;
  parse_method: 'spreadsheet' | 'pdf-text' | 'ai-text' | 'ai-vision';
  reconciliation: number | null;
  warnings: string[];
  period_start: string | null;
  period_end: string | null;
  tx_count: number;
  uploaded_at: string;
  uploaded_by: string | null;
  inflow: number;
  outflow: number;
  pending_review: number;
  flagged: number;
}
export interface Rule {
  id: string;
  pattern: string;
  match_type: 'contains' | 'regex';
  category: string;
  shop_id: string | null;
  shop_name: string | null;
  created_at: string;
}
export interface Analytics {
  currency: string;
  totals: {
    count: number;
    inflow: number;
    outflow: number;
    credit_count: number;
    debit_count: number;
    flagged: number;
    pending: number;
    verified: number;
    suspicious: number;
    uncategorized: number;
    ai_categorized: number;
    statements: number;
    date_from: string | null;
    date_to: string | null;
  };
  monthly: { month: string; inflow: number; outflow: number; count: number }[];
  categories: { category: string; direction: Direction; amount: number; count: number; group: GroupId }[];
  groups: { id: GroupId; label: string; outflow: number; inflow: number; count: number }[];
  channels: { channel: string; direction: Direction; amount: number; count: number }[];
  topPayees: { name: string; amount: number; count: number; category: string }[];
  topPayers: { name: string; amount: number; count: number; category: string }[];
  shops: { id: string; name: string; inflow: number; outflow: number; count: number; pending: number }[];
  banks: { bank: string; inflow: number; outflow: number; count: number }[];
  weekday: { dow: number; inflow: number; outflow: number; count: number }[];
  daily: { date: string; inflow: number; outflow: number }[];
  largest: (Pick<Transaction, 'id' | 'date' | 'description' | 'counterparty' | 'amount' | 'category' | 'bank' | 'shop_name' | 'flagged' | 'review_status'> & { group: GroupId })[];
  reviewReasons: { code: string; severity: string; count: number }[];
}

export interface TxFilters {
  shopIds?: string[];
  statementIds?: string[];
  banks?: string[];
  categories?: string[];
  channels?: string[];
  from?: string;
  to?: string;
  direction?: Direction | '';
  flagged?: 'true' | 'false' | '';
  review?: ReviewStatus | 'none' | '';
  reason?: string;
  q?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any,
  ) {
    super(message);
  }
}

/** Comma-join arrays and drop empty values (the API accepts `a,b,c` lists). */
export function toParams(params: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.join(',');
    } else out[k] = String(v);
  }
  return out;
}

function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as any;
    return new ApiError(err.response?.status ?? 0, body?.error ?? (err.response ? err.message : 'Network error: is the API running?'), body);
  }
  return new ApiError(0, err instanceof Error ? err.message : String(err), null);
}

const BASE = '/bank-statements';

/** Calls the retail-erp API (auth, tenant and X-Shop-Id headers come from apiClient) and unwraps `{ success, data }`. */
async function request<T>(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, opts: { params?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
  try {
    const res = await apiClient.request({ method, url: BASE + path, params: opts.params ? toParams(opts.params) : undefined, data: opts.body });
    return res.data?.data as T;
  } catch (err) {
    throw toApiError(err);
  }
}

export const api = {
  meta: () => request<Meta>('get', '/meta'),
  analytics: (f: TxFilters) => request<Analytics>('get', '/analytics', { params: { ...f } }),
  transactions: (f: TxFilters & { page?: number; pageSize?: number; sort?: string; dir?: 'asc' | 'desc' }) =>
    request<TxPage>('get', '/transactions', { params: { ...f } }),
  transaction: (id: string) => request<Transaction>('get', `/transactions/${id}`),
  facets: () => request<{ banks: string[]; channels: string[] }>('get', '/transactions/facets'),
  updateTx: (id: string, patch: Partial<Pick<Transaction, 'category' | 'review_status' | 'reviewer_note'>>) =>
    request<Transaction>('patch', `/transactions/${id}`, { body: patch }),
  bulkUpdate: (ids: string[], patch: Partial<Pick<Transaction, 'category' | 'review_status'>>) =>
    request<{ updated: number }>('post', '/transactions/bulk', { body: { ids, ...patch } }),
  statements: (shopIds?: string[]) => request<Statement[]>('get', '/statements', { params: { shopIds } }),
  updateStatement: (id: string, patch: { bank?: string; shopId?: string }) =>
    request<Statement>('patch', `/statements/${id}`, { body: patch }),
  deleteStatement: (id: string) => request<void>('delete', `/statements/${id}`),
  recategorize: (id: string) =>
    request<{ updated: number; aiUsed: boolean; aiError: string | null }>('post', `/statements/${id}/recategorize`),
  rules: () => request<Rule[]>('get', '/rules'),
  createRule: (r: { pattern: string; match_type: 'contains' | 'regex'; category: string; shop_id: string | null; applyToExisting: boolean }) =>
    request<{ rule: Rule; applied: number }>('post', '/rules', { body: r }),
  deleteRule: (id: string) => request<void>('delete', `/rules/${id}`),
  saveSettings: (s: Partial<Settings>) => request<Settings>('put', '/settings', { body: s }),
};

/** Download the filtered transactions as Excel / CSV (needs the auth header, so no plain link). */
export async function downloadExport(f: TxFilters, format: 'xlsx' | 'csv') {
  let res;
  try {
    res = await apiClient.get(`${BASE}/export`, { params: toParams({ ...f, format }), responseType: 'blob' });
  } catch (err) {
    // Error bodies arrive as a Blob too; surface the JSON message.
    const blob = axios.isAxiosError(err) ? (err.response?.data as Blob | undefined) : undefined;
    const text = blob instanceof Blob ? await blob.text().catch(() => '') : '';
    let message = 'Export failed';
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0, message, null);
  }
  const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? `bank-transactions.${format}`;
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Upload one statement with progress. Text fields must precede the file in the form. */
export async function uploadStatement(
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ statement: Statement; aiUsed: boolean }> {
  try {
    const res = await apiClient.post(`${BASE}/statements/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => e.total && onProgress(e.loaded / e.total),
      signal,
      // Parsing + AI can take a while on large or scanned statements.
      timeout: 10 * 60_000,
    });
    return res.data.data;
  } catch (err) {
    throw toApiError(err);
  }
}
