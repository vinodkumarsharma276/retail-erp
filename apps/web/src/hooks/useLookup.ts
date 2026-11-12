import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse } from '@retailerp/shared-types';

/**
 * GET /api/v1/lookup/brands — the makes sold under a product type (with its
 * parent and sub-types): the type's Brand catalog, its brand list and makes
 * on stock. The field suggests from this rather than restricting to it, so a
 * new make is typed once and offered from then on.
 */
export function useBrandsQuery(categoryId: string | undefined) {
  return useQuery({
    queryKey: ['lookup', 'brands', categoryId] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<string[]>>('/lookup/brands', {
        params: { categoryId },
      });
      return data.data ?? [];
    },
    enabled: Boolean(categoryId),
    staleTime: 5 * 60 * 1000,
  });
}

/** GET /api/v1/lookup/models — model numbers of one make within a product type. */
export function useModelsQuery(categoryId: string | undefined, brand: string | undefined) {
  const make = (brand ?? '').trim().toUpperCase();
  return useQuery({
    queryKey: ['lookup', 'models', categoryId, make] as const,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<string[]>>('/lookup/models', {
        params: { categoryId, brand: make },
      });
      return data.data ?? [];
    },
    enabled: Boolean(categoryId && make),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * GET /api/v1/lookup/cities — distinct cities used on existing customer /
 * distributor records. Cached aggressively because the list barely changes
 * and powers a passive autocomplete dropdown.
 */
export function useCitiesQuery() {
  return useQuery({
    queryKey: ['lookup', 'cities'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<string[]>>('/lookup/cities');
      return data.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
