import { apiClient } from '../lib/api-client';
import type { PermissionGroup, ShopListItem } from '@retailerp/shared-types';

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  userCount: number;
  permissions: string[];
}

export interface UserSummary {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string;
  role: string;
  roleId: string | null;
  isActive: boolean;
  isMobileOnly: boolean;
  lastLoginAt: string | null;
  knownPassword: string | null;
  customRole: { id: string; code: string; name: string } | null;
  userShops: Array<{ isPrimary: boolean; shop: { id: string; code: string; name: string } }>;
}

const unwrap = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const rolesApi = {
  catalog: () => unwrap<PermissionGroup[]>(apiClient.get('/roles/permissions/catalog')),
  listShops: () => unwrap<ShopListItem[]>(apiClient.get('/auth/shops')),
  listRoles: () => unwrap<RoleSummary[]>(apiClient.get('/roles')),
  getRole: (id: string) => unwrap<RoleSummary>(apiClient.get(`/roles/${id}`)),
  createRole: (input: { code: string; name: string; description?: string }) =>
    unwrap<RoleSummary>(apiClient.post('/roles', input)),
  updateRole: (
    id: string,
    input: { name?: string; description?: string; isActive?: boolean },
  ) => unwrap<RoleSummary>(apiClient.put(`/roles/${id}`, input)),
  deleteRole: (id: string) => unwrap<{ ok: boolean }>(apiClient.delete(`/roles/${id}`)),
  setPermissions: (id: string, permissions: string[]) =>
    unwrap<{ permissions: string[] }>(
      apiClient.put(`/roles/${id}/permissions`, { permissions }),
    ),
  cloneRole: (id: string, code: string, name: string) =>
    unwrap<RoleSummary>(apiClient.post(`/roles/${id}/clone`, { code, name })),
  listUsers: () => unwrap<UserSummary[]>(apiClient.get('/roles/users')),
  assignUserRole: (userId: string, roleId: string | null) =>
    unwrap<{ id: string; roleId: string | null; role: string }>(
      apiClient.put(`/roles/users/${userId}/role`, { roleId }),
    ),
  assignUserShops: (userId: string, shopIds: string[]) =>
    unwrap<UserSummary>(apiClient.put(`/users/${userId}/assign-shops`, { shopIds })),
  resetUserPassword: (userId: string, password?: string) =>
    unwrap<{ newPassword: string }>(
      apiClient.post(`/roles/users/${userId}/reset-password`, password ? { password } : {}),
    ),

  // Per-user permission overrides (Owner-only by default).
  getUserPermissions: (userId: string) =>
    unwrap<UserPermissionsResponse>(apiClient.get(`/roles/users/${userId}/permissions`)),
  setUserPermissions: (userId: string, grants: string[], denies: string[]) =>
    unwrap<UserPermissionsResponse>(
      apiClient.put(`/roles/users/${userId}/permissions`, { grants, denies }),
    ),
};

export interface UserPermissionsResponse {
  userId: string;
  role: { id: string; code: string; name: string } | null;
  /** Keys granted by the user's role (read-only baseline). */
  rolePermissions: string[];
  /** Keys force-allowed by per-user override. */
  grants: string[];
  /** Keys force-revoked by per-user override. */
  denies: string[];
  /** Resolved set the system actually checks. */
  effective: string[];
}
