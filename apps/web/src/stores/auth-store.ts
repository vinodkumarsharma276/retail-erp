import { create } from 'zustand';
import type { UserRole } from '@retailerp/shared-types';

interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isMobileOnly: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!sessionStorage.getItem('accessToken'),
  login: (user, accessToken, refreshToken) => {
    sessionStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({ user, isAuthenticated: true });
  },
  logout: () => {
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentShopId');
    set({ user: null, isAuthenticated: false });
  },
}));
