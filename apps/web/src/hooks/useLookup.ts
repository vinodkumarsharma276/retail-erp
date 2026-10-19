import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse } from '@retailerp/shared-types';

/**
 * GET /api/v1/lookup/brands — the makes worth offering for a category: the
 * ones its brand attribute lists and the ones already on its stock. The
 * field suggests from this rather than restricting to it, so a new make is
 * typed once and offered from then on.
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
