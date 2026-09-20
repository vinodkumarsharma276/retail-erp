import { create } from 'zustand';
import { PLATFORM_ACCESS_TOKEN_KEY, PLATFORM_REFRESH_TOKEN_KEY } from '../lib/platform-api-client';

/**
 * Platform admin session store. Mirrors the tenant `auth-store` shape
 * but uses distinct localStorage keys and identity fields (no role / no
 * tenantId — platform admins are flat operators).
 */
export interface PlatformUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
}

interface PlatformAuthState {
  user: PlatformUser | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (user: PlatformUser, accessToken: string, refreshToken: string) => void;
  setUser: (user: PlatformUser) => void;
  logout: () => void;
  setHydrated: () => void;
}

export const usePlatformAuthStore = create<PlatformAuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrated: !localStorage.getItem(PLATFORM_ACCESS_TOKEN_KEY),
  login: (user, accessToken, refreshToken) => {
    localStorage.setItem(PLATFORM_ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(PLATFORM_REFRESH_TOKEN_KEY, refreshToken);
    set({ user, isAuthenticated: true, isHydrated: true });
  },
  setUser: (user) => set({ user, isAuthenticated: true, isHydrated: true }),
  logout: () => {
    localStorage.removeItem(PLATFORM_ACCESS_TOKEN_KEY);
    localStorage.removeItem(PLATFORM_REFRESH_TOKEN_KEY);
    set({ user: null, isAuthenticated: false, isHydrated: true });
  },
  setHydrated: () => set({ isHydrated: true }),
}));

export function hasPlatformToken(): boolean {
  return !!localStorage.getItem(PLATFORM_ACCESS_TOKEN_KEY);
}
