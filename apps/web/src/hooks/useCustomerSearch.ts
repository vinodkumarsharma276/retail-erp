import axios from 'axios';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@retailerp/shared-types';
import type { RegisterSheetRow } from '@retailerp/shared-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CustomerRef {
  id: string;
  name: string;
  customerCode: string;
}

export interface CustomerSearchEntry {
  id: string;
  accountNumber: string;
  prefix: string;
  seriesNo: number | null;
  /** Null when the entry has no customer name to file it under. */
  customerId: string | null;
  customerName: string;
  /** '' when there's no valid mobile. Absent without `customers.view_phone`. */
  mobile?: string;
  address: string | null;
  area: string | null;
  coCustomerId: string | null;
  coName: string | null;
  coMobile?: string | null;
  purchaseDate: string | null;
  categoryId: string | null;
  /** Product type names from the top down (Electronics, TV, LED TV); null when none is set. */
  productType: string[] | null;
  product: string | null;
  brand: string | null;
  model: string | null;
  /** "Needs review" problem codes (REGISTER_ISSUES). */
  issues: string[];
  /** Sheet values that couldn't be used (a 9-digit mobile, an unreadable date). */
  rawValues?: { mobile?: string; coMobile?: string; purchaseDate?: string } | null;
  source: 'import' | 'app';
  shopId: string;
  createdAt: string;
  updatedAt: string;
  customer: CustomerRef | null;
  coCustomer: CustomerRef | null;
  shop: { id: string; name: string; code: string };
  /** Entries this entry's customer has in all (the "3 items" chip). */
  customerItemCount: number;
}

export interface CustomerSearchDetail extends CustomerSearchEntry {
  customer: (CustomerRef & { phone?: string; addressLine1: string | null; addressLine2: string | null }) | null;
  coCustomer: (CustomerRef & { phone?: string }) | null;
  creator: { id: string; fullName: string; username: string } | null;
  importBatch: { id: string; fileName: string; rowFrom: number; rowTo: number; createdAt: string } | null;
  matchingSale: { id: string; saleNumber: string; ledgerNumber: string; saleDate: string | null; shop: { code: string } } | null;
}

export interface CustomerSearchFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  prefix?: string;
  area?: string;
  shopId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** A product type id (includes the types under it), or `none`. */
  categoryId?: string;
  /** "Needs review": `any`, or one problem code. */
  issue?: string;
}

export interface ReviewSummary {
  total: number;
  issues: Array<{ code: string; label: string; count: number }>;
}

export interface PrefixInfo {
  prefix: string;
  count: number;
  lastAccountNumber: string | null;
  nextAccountNumber: string;
}

export interface CustomerMatch {
  id: string;
  name: string;
  customerCode: string;
  phone?: string;
  addressLine1: string | null;
  addressLine2: string | null;
  isGuarantor: boolean;
  itemCount: number;
  exact: boolean;
  score: number | null;
}

export interface EntryPayload {
  accountNumber: string;
  customerName: string;
  /** Optional: an entry without one is saved and listed under "Needs review". */
  mobile?: string | null;
  address?: string | null;
  area?: string | null;
  coName?: string | null;
  coMobile?: string | null;
  purchaseDate: string;
  categoryId: string;
  product?: string | null;
  brand?: string | null;
  model?: string | null;
  customerId?: string | null;
  coCustomerId?: string | null;
  shopId?: string;
  /** Save even though the account number is already used. */
  allowDuplicate?: boolean;
}

export type ImportRow = RegisterSheetRow;

export interface ImportVariant {
  key: string;
  name: string;
  rows: number;
  customerId?: string;
  customerCode?: string;
}

export interface ImportNameGroup {
  mobile: string;
  variants: ImportVariant[];
  suggestion: Record<string, string>;
  needsReview: boolean;
  verdicts: Array<{ a: string; b: string; score: number; same: boolean; by: 'score' | 'ai'; reason?: string }>;
}

export interface ImportPersonMatch {
  kind: 'existing' | 'new' | 'group';
  variantKey: string;
  customerId?: string;
  customerCode?: string;
}

export interface ImportPreviewRow extends ImportRow {
  /** `move`: already in the register under another shop; importing moves it there. */
  status: 'new' | 'exists' | 'move' | 'invalid';
  errors: string[];
  warnings: string[];
  /** Problems the entry will be listed with under "Needs review". */
  issues: string[];
  shopCode: string | null;
  moveFrom?: string;
  customer?: ImportPersonMatch;
  co?: ImportPersonMatch;
}

export interface ImportProductType {
  textKey: string;
  text: string;
  rows: number;
  /** `glossary`: a known way staff write it; `ai`: the model's suggestion (check it). */
  kind: 'mapped' | 'glossary' | 'matched' | 'similar' | 'ai' | 'new';
  categoryId: string | null;
  categoryName: string | null;
  /** A type the glossary or the AI says to create. */
  create?: { name: string; parentId: string | null; label: string };
  /** What is pre-filled. */
  suggestion: ProductTypeDecision;
  reason?: string;
  /** A few "Brand / Model" pairs written beside it. */
  samples: string[];
}

export type ProductTypeDecision =
  | { action: 'existing'; categoryId: string }
  | { action: 'create'; name: string; parentId?: string | null }
  | { action: 'blank' };

export interface ImportPreview {
  rows: ImportPreviewRow[];
  groups: ImportNameGroup[];
  productTypes: ImportProductType[];
  topLevelTypes: Array<{ id: string; name: string }>;
  /** Every type, by full path. */
  typeOptions: Array<{ id: string; label: string }>;
  /** How the Product column is read. */
  productHelp: { rules: string[]; glossary: Array<{ type: string; texts: string[]; note: string | null }> };
  summary: {
    total: number;
    new: number;
    exists: number;
    move: number;
    invalid: number;
    flagged: number;
    groups: number;
    groupsNeedingReview: number;
    newProductTypes: number;
    unknownProductTexts: number;
    /** Entries the new rows make (a row naming several items makes one each). */
    entries: number;
    splitRows: number;
    itemsUnknown: number;
    aiUsed: boolean;
    aiFailed: boolean;
    aiAvailable: boolean;
    productAiAvailable: boolean;
    productAiUsed: boolean;
    productAiFailed: boolean;
  };
}

export interface ImportRequest {
  fileName: string;
  shopId: string;
  rowFrom: number;
  rowTo: number;
  rows: ImportRow[];
}

export interface ImportResult {
  batchId: string;
  inserted: number;
  skipped: number;
  moved: number;
  invalid: number;
  flagged: number;
  customersCreated: number;
  customersLinked: number;
  productTypesCreated: number;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  rowFrom: number;
  rowTo: number;
  inserted: number;
  skipped: number;
  moved: number;
  invalid: number;
  flagged: number;
  customersCreated: number;
  customersLinked: number;
  createdAt: string;
  shop: { id: string; name: string; code: string };
  creator: { id: string; fullName: string; username: string } | null;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  all: ['customer-search'] as const,
  list: (filters: CustomerSearchFilters) => ['customer-search', 'list', filters] as const,
  detail: (id: string) => ['customer-search', 'detail', id] as const,
  prefixes: ['customer-search', 'prefixes'] as const,
  nextNumber: (prefix: string) => ['customer-search', 'next-number', prefix] as const,
  matches: (mobile: string, name: string) => ['customer-search', 'matches', mobile, name] as const,
  forCustomer: (id: string) => ['customer-search', 'customer', id] as const,
  batches: ['customer-search', 'batches'] as const,
  review: ['customer-search', 'review-summary'] as const,
};

/** The API's message, for toasts and inline errors. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) return (error.response?.data as { error?: string } | undefined)?.error ?? fallback;
  return error instanceof Error ? error.message : fallback;
}

/** The next free number the API suggested when a number was taken. */
export function takenSuggestion(error: unknown): string | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  return (error.response.data as { details?: { nextAccountNumber?: string | null } }).details?.nextAccountNumber ?? null;
}

/** True when the API refused only because the account number is already used (it can be saved anyway). */
export function isTakenNumber(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409 && !!(error.response.data as { details?: unknown }).details;
}

export function useReviewSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: keys.review,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ReviewSummary>>('/customer-search/review-summary');
      return data.data!;
    },
    enabled,
  });
}

function toParams(filters: object) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  return params.toString();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useCustomerSearchQuery(filters: CustomerSearchFilters) {
  return useQuery({
    queryKey: keys.list(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<CustomerSearchEntry>>(`/customer-search?${toParams(filters)}`);
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useCustomerSearchEntryQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CustomerSearchDetail>>(`/customer-search/${id}`);
      return data.data!;
    },
    enabled: !!id,
  });
}

export function usePrefixesQuery(enabled = true) {
  return useQuery({
    queryKey: keys.prefixes,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<PrefixInfo[]>>('/customer-search/prefixes');
      return data.data!;
    },
    enabled,
  });
}

export function useNextNumberQuery(prefix: string, enabled = true) {
  const p = prefix.trim().toUpperCase();
  return useQuery({
    queryKey: keys.nextNumber(p),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ prefix: string; lastAccountNumber: string | null; nextAccountNumber: string }>>(
        `/customer-search/next-number?prefix=${encodeURIComponent(p)}`,
      );
      return data.data!;
    },
    enabled: enabled && /^[A-Z]{1,2}$/.test(p),
    staleTime: 0,
  });
}

/** Customers already on a mobile (10 digits), closest name first. */
export function useCustomerMatchesQuery(mobile: string, name: string) {
  const digits = mobile.replace(/\D/g, '').slice(-10);
  return useQuery({
    queryKey: keys.matches(digits, name.trim()),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<CustomerMatch[]>>(
        `/customer-search/customer-matches?${toParams({ mobile: digits, name: name.trim() })}`,
      );
      return data.data!;
    },
    enabled: digits.length === 10,
    placeholderData: keepPreviousData,
  });
}

/** Items a customer bought and entries they are co-applicant on. */
export function useCustomerRegisterQuery(customerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.forCustomer(customerId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<{ items: CustomerSearchEntry[]; coApplicantOn: CustomerSearchEntry[] }>>(
        `/customer-search/by-customer/${customerId}`,
      );
      return data.data!;
    },
    enabled: enabled && !!customerId,
  });
}

export function useImportBatchesQuery(enabled = true) {
  return useQuery({
    queryKey: keys.batches,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ImportBatch[]>>('/customer-search/import/batches');
      return data.data!;
    },
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function useCreateEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EntryPayload) => {
      const { data } = await apiClient.post<ApiResponse<CustomerSearchEntry>>('/customer-search', payload);
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.all });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useUpdateEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<EntryPayload> }) => {
      const { data } = await apiClient.patch<ApiResponse<CustomerSearchEntry>>(`/customer-search/${id}`, payload);
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.all });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useDeleteEntryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<ApiResponse<{ id: string; accountNumber: string }>>(`/customer-search/${id}`);
      return data.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: keys.detail(id) });
      queryClient.invalidateQueries({ queryKey: keys.all });
    },
  });
}

export function useImportPreviewMutation() {
  return useMutation({
    mutationFn: async (payload: ImportRequest) => {
      const { data } = await apiClient.post<ApiResponse<ImportPreview>>('/customer-search/import/preview', payload, { timeout: 300_000 });
      return data.data!;
    },
  });
}

export function useImportCommitMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: ImportRequest & {
        resolutions: Record<string, Record<string, string>>;
        productTypes: Record<string, ProductTypeDecision>;
      },
    ) => {
      const { data } = await apiClient.post<ApiResponse<ImportResult>>('/customer-search/import', payload, { timeout: 330_000 });
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.all });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/** Download the (filtered) register as Excel; a plain link can't send the auth header. */
export async function downloadCustomerSearchExport(filters: CustomerSearchFilters) {
  const { page: _p, pageSize: _s, ...rest } = filters;
  const res = await apiClient.get(`/customer-search/export?${toParams(rest)}`, { responseType: 'blob' });
  const cd = String(res.headers['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'customer-searching.xlsx';
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
