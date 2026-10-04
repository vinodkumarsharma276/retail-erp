import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Transaction, type TxFilters } from './api';

export function useMeta() {
  return useQuery({ queryKey: ['bank-meta'], queryFn: api.meta, staleTime: 60_000 });
}

export function useAnalytics(f: TxFilters) {
  return useQuery({ queryKey: ['bank-analytics', f], queryFn: () => api.analytics(f), placeholderData: keepPreviousData });
}

export function useTransactions(f: Parameters<typeof api.transactions>[0]) {
  return useQuery({ queryKey: ['bank-transactions', f], queryFn: () => api.transactions(f), placeholderData: keepPreviousData });
}

export function useStatements(shopIds?: string[]) {
  return useQuery({ queryKey: ['bank-statements', shopIds], queryFn: () => api.statements(shopIds) });
}

export function useFacets() {
  return useQuery({ queryKey: ['bank-facets'], queryFn: api.facets, staleTime: 30_000 });
}

/** Anything that changes transactions invalidates every derived view. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['bank-transactions'] }),
      qc.invalidateQueries({ queryKey: ['bank-analytics'] }),
      qc.invalidateQueries({ queryKey: ['bank-statements'] }),
      qc.invalidateQueries({ queryKey: ['bank-facets'] }),
      qc.invalidateQueries({ queryKey: ['bank-review-count'] }),
    ]);
}

export function useUpdateTx() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTx>[1] }) => api.updateTx(id, patch),
    onSuccess: () => invalidate(),
  });
}

export function useBulkUpdate() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: Parameters<typeof api.bulkUpdate>[1] }) => api.bulkUpdate(ids, patch),
    onSuccess: () => invalidate(),
  });
}

export function usePendingCount(shopIds: string[]) {
  return useQuery({
    queryKey: ['bank-review-count', shopIds],
    queryFn: () => api.transactions({ shopIds, review: 'pending', pageSize: 10 }).then((r) => r.total),
    refetchInterval: 30_000,
  });
}

export type { Transaction };
