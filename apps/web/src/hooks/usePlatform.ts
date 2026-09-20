/**
 * React Query hooks for the platform-admin module. Mirrors the per-tenant
 * `useAuth.ts` / module hook layout for consistency.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { platformApiClient } from '../lib/platform-api-client';
import type { ApiResponse, FeatureKeyType } from '@retailerp/shared-types';
import type { PlatformUser } from '../stores/platform-auth-store';

// ─── Types matching the API DTOs ────────────────────────────────────────────

export interface PlanListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  isPublic: boolean;
  isActive: boolean;
  features: PlanFeature[];
  _count?: { tenants: number };
}

export interface PlanFeature {
  id: string;
  planId: string;
  featureKey: string;
  enabled: boolean;
  valueJson: Record<string, unknown> | null;
}

export interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  gstNumber: string | null;
  status: 'active' | 'trial' | 'suspended' | 'cancelled';
  planId: string;
  trialEndsAt: string | null;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
  plan: { id: string; code: string; name: string };
  _count: { shops: number; users: number };
}

export interface TenantDetail extends TenantListItem {
  features: Array<{
    id: string;
    tenantId: string;
    featureKey: string;
    enabled: boolean;
    valueJson: Record<string, unknown> | null;
    note: string | null;
  }>;
  _count: { shops: number; users: number; customers: number; saleRecords: number };
}

export interface TenantEffectiveFeature {
  featureKey: string;
  enabled: boolean;
  valueJson: unknown;
  source: 'plan' | 'override';
  note: string | null;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export function usePlatformLoginMutation() {
  return useMutation({
    mutationFn: async (payload: { username: string; password: string }) => {
      const { data } = await platformApiClient.post<
        ApiResponse<{
          accessToken: string;
          refreshToken: string;
          platformUser: PlatformUser;
        }>
      >('/platform/auth/login', payload);
      return data.data!;
    },
  });
}

export function usePlatformMeQuery(enabled = true) {
  return useQuery({
    queryKey: ['platform', 'me'],
    queryFn: async () => {
      const { data } = await platformApiClient.get<
        ApiResponse<{ platformUser: PlatformUser }>
      >('/platform/auth/me');
      return data.data!;
    },
    enabled,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function usePlatformLogoutMutation() {
  return useMutation({
    mutationFn: async () => {
      const refreshToken = localStorage.getItem('platformRefreshToken') ?? '';
      await platformApiClient.post('/platform/auth/logout', { refreshToken });
    },
  });
}

// ─── Tenants ────────────────────────────────────────────────────────────────

export function useTenantsListQuery(filter?: { status?: string; q?: string }) {
  return useQuery({
    queryKey: ['platform', 'tenants', filter],
    queryFn: async () => {
      const { data } = await platformApiClient.get<ApiResponse<TenantListItem[]>>(
        '/platform/tenants',
        { params: filter },
      );
      return data.data ?? [];
    },
  });
}

export function useTenantDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'tenant', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await platformApiClient.get<ApiResponse<TenantDetail>>(
        `/platform/tenants/${id}`,
      );
      return data.data!;
    },
  });
}

export function useTenantFeaturesQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'tenant', id, 'features'],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await platformApiClient.get<
        ApiResponse<TenantEffectiveFeature[]>
      >(`/platform/tenants/${id}/features`);
      return data.data ?? [];
    },
  });
}

export interface CreateTenantPayload {
  slug: string;
  name: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  gstNumber?: string | null;
  planCode: string;
  trialEndsAt?: string | null;
  owner: {
    username: string;
    password: string;
    fullName: string;
    email?: string | null;
    phone: string;
  };
  initialShop?: {
    code: string;
    name: string;
    gstNumber: string;
    panNumber: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
  };
}

export function useCreateTenantMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateTenantPayload) => {
      const { data } = await platformApiClient.post<
        ApiResponse<{
          tenant: TenantListItem;
          owner: { id: string; username: string; fullName: string; role: string };
          initialShop: { id: string; code: string; name: string } | null;
        }>
      >('/platform/tenants', payload);
      return data.data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    },
  });
}

export interface UpdateTenantPayload {
  name?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  gstNumber?: string | null;
  status?: 'active' | 'trial' | 'suspended' | 'cancelled';
  planCode?: string;
  trialEndsAt?: string | null;
  customDomain?: string | null;
}

export function useUpdateTenantMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateTenantPayload) => {
      const { data } = await platformApiClient.patch<ApiResponse<TenantListItem>>(
        `/platform/tenants/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', id] });
    },
  });
}

export function useUpsertTenantFeatureMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      featureKey: FeatureKeyType | string;
      enabled: boolean;
      valueJson?: Record<string, unknown> | null;
      note?: string | null;
    }) => {
      const { data } = await platformApiClient.post(
        `/platform/tenants/${tenantId}/features`,
        payload,
      );
      return data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId, 'features'] });
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId] });
    },
  });
}

export function useDeleteTenantFeatureOverrideMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (featureKey: string) => {
      await platformApiClient.delete(`/platform/tenants/${tenantId}/features/${featureKey}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId, 'features'] });
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId] });
    },
  });
}

export function useResetTenantOwnerPasswordMutation(tenantId: string) {
  return useMutation({
    mutationFn: async () => {
      const { data } = await platformApiClient.post<
        ApiResponse<{ username: string; temporaryPassword: string }>
      >(`/platform/tenants/${tenantId}/reset-owner-password`);
      return data.data!;
    },
  });
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export function usePlansListQuery() {
  return useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: async () => {
      const { data } = await platformApiClient.get<ApiResponse<PlanListItem[]>>(
        '/platform/plans',
      );
      return data.data ?? [];
    },
  });
}

export function usePlanDetailQuery(code: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'plan', code],
    enabled: !!code,
    queryFn: async () => {
      const { data } = await platformApiClient.get<ApiResponse<PlanListItem>>(
        `/platform/plans/${code}`,
      );
      return data.data!;
    },
  });
}

export function useCreatePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      code: string;
      name: string;
      description?: string | null;
      priceMonthly: number;
      priceYearly: number;
      isPublic: boolean;
      isActive: boolean;
    }) => {
      const { data } = await platformApiClient.post<ApiResponse<PlanListItem>>(
        '/platform/plans',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
}

export function useUpdatePlanMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<{
      name: string;
      description: string | null;
      priceMonthly: number;
      priceYearly: number;
      isPublic: boolean;
      isActive: boolean;
    }>) => {
      const { data } = await platformApiClient.patch<ApiResponse<PlanListItem>>(
        `/platform/plans/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
}

export function useSetPlanFeatureMutation(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      featureKey: string;
      enabled: boolean;
      valueJson?: Record<string, unknown> | null;
    }) => {
      const { data } = await platformApiClient.post<ApiResponse<PlanFeature>>(
        `/platform/plans/${planId}/features`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
}
