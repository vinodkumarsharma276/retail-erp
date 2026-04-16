import { create } from 'zustand';
import type { UserRole } from '@retailerp/shared-types';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isMobileOnly: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrated: !localStorage.getItem('accessToken'),
  login: (user, accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ user, isAuthenticated: true, isHydrated: true });
  },
  logout: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentShopId');
    localStorage.removeItem('currentShopName');
    localStorage.removeItem('currentShopCode');
    set({ user: null, isAuthenticated: false, isHydrated: true });
  },
  setHydrated: () => set({ isHydrated: true }),
}));

export function hasStoredToken(): boolean {
  return !!localStorage.getItem('accessToken');
}
