import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShopListItem, ApiResponse } from '@retailerp/shared-types';
import apiClient from '../lib/api-client';
import { useAuthStore } from '../stores/auth-store';

/** Fetch list of shops for the login dropdown */
export function useShopsQuery() {
  return useQuery<ShopListItem[]>({
    queryKey: ['shops'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ShopListItem[]>>('/auth/shops');
      return response.data.data!;
    },
    staleTime: 1000 * 60 * 30, // 30 minutes — shops rarely change
  });
}

/** Login mutation — delegates to auth store */
export function useLoginMutation() {
  const login = useAuthStore((s) => s.login);

  return useMutation<
    void,
    Error,
    { username: string; password: string; shopId: string }
  >({
    mutationFn: ({ username, password, shopId }) =>
      login(username, password, shopId),
  });
}

/** Logout mutation — clears auth state, invalidates queries */
export function useLogoutMutation() {
  const logout = useAuthStore((s) => s.logout);
  const qc = useQueryClient();

  return useMutation<void, Error>({
    mutationFn: () => logout(),
    onSuccess: () => {
      qc.clear();
    },
  });
}
