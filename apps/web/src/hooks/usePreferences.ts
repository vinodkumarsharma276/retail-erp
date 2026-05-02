import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse, UserPreferences } from '@retailerp/shared-types';
import { usePreferencesStore } from '../stores/preferences-store';

/**
 * Mutation: update current user preferences. Optimistically updates the local
 * Zustand store so theme/currency/date format changes apply immediately.
 */
export function useUpdatePreferencesMutation() {
  const queryClient = useQueryClient();
  const patch = usePreferencesStore((s) => s.patch);
  const setPreferences = usePreferencesStore((s) => s.setPreferences);

  return useMutation({
    mutationFn: async (partial: Partial<UserPreferences>) => {
      // Optimistic local update for instant UI feedback
      patch(partial);
      const { data } = await apiClient.put<ApiResponse<UserPreferences>>(
        '/auth/preferences',
        partial,
      );
      return data.data ?? {};
    },
    onSuccess: (saved) => {
      // Re-sync with server-authoritative state
      setPreferences(saved);
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
