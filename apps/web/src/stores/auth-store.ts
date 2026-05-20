import { create } from 'zustand';
import type { UserRole } from '@retailerp/shared-types';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  roleId?: string | null;
  isMobileOnly: boolean;
}

interface AuthState {
  user: AuthUser | null;
  permissions: Set<string>;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (
    user: AuthUser,
    accessToken: string,
    refreshToken: string,
    permissions?: string[],
  ) => void;
  setPermissions: (permissions: string[]) => void;
  logout: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  permissions: new Set<string>(),
  isAuthenticated: false,
  isHydrated: !localStorage.getItem('accessToken'),
  login: (user, accessToken, refreshToken, permissions) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({
      user,
      permissions: new Set(permissions ?? []),
      isAuthenticated: true,
      isHydrated: true,
    });
  },
  setPermissions: (permissions) => set({ permissions: new Set(permissions) }),
  logout: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentShopId');
    localStorage.removeItem('currentShopName');
    localStorage.removeItem('currentShopCode');
    // Tenant chrome (name in header etc.) clears on logout too. The
    // tenant slug derived from the hostname is independent of this and
    // persists across logouts so the user always lands on their own
    // tenant's login page.
    localStorage.removeItem('tenantContext');
    set({ user: null, permissions: new Set(), isAuthenticated: false, isHydrated: true });
  },
  setHydrated: () => set({ isHydrated: true }),
}));

export function hasStoredToken(): boolean {
  return !!localStorage.getItem('accessToken');
}
