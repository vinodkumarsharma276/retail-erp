import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  LoginRequest,
  LoginResponse,
  ShopListItem,
  ApiResponse,
  User,
  AuthTenantContext,
  TenantFeatureSnapshot,
} from '@retailerp/shared-types';

// GET /api/v1/auth/shops — public, no auth needed
export function useShopsQuery() {
  return useQuery({
    queryKey: ['auth', 'shops'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<ShopListItem[]>>(
        '/auth/shops',
      );
      return data.data!;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes — shop list rarely changes
  });
}

// POST /api/v1/auth/login
export function useLoginMutation() {
  return useMutation({
    mutationFn: async (payload: LoginRequest) => {
      const { data } = await apiClient.post<ApiResponse<LoginResponse>>(
        '/auth/login',
        payload,
      );
      return data.data!;
    },
  });
}

// POST /api/v1/auth/logout
export function useLogoutMutation() {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout');
    },
  });
}

// GET /api/v1/auth/me — validate token + get current user
export function useMeQuery(enabled = true) {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data } = await apiClient.get<
        ApiResponse<{
          user: User;
          shops: ShopListItem[];
          permissions: string[];
          tenant: AuthTenantContext;
          features: TenantFeatureSnapshot;
        }>
      >('/auth/me');
      return data.data!;
    },
    enabled,
    retry: false,
    // Always treat permissions as stale so any mount or focus refetches
    // them. Combined with route-change invalidation in ProtectedRoute this
    // means an admin's permission edit takes effect for the affected user
    // on their very next navigation, not after a 30s window.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
}

// POST /api/v1/auth/switch-shop
export function useSwitchShopMutation() {
  return useMutation({
    mutationFn: async (shopId: string) => {
      const { data } = await apiClient.post<
        ApiResponse<{ accessToken: string; shop: ShopListItem }>
      >('/auth/switch-shop', { shopId });
      return data.data!;
    },
  });
}
