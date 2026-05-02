import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse } from '@retailerp/shared-types';

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
