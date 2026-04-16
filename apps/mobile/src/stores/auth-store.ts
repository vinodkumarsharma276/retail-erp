import { create } from 'zustand';
import type { UserRole } from '@retailerp/shared-types';
import {
  setToken,
  setRefreshToken,
  setShopId,
  getToken,
  getShopId,
  clearAll,
} from '../lib/storage';
import apiClient from '../lib/api-client';

interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isMobileOnly: boolean;
}

interface AuthShop {
  id: string;
  name: string;
  code: string;
}

interface AuthState {
  user: AuthUser | null;
  shop: AuthShop | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (
    username: string,
    password: string,
    shopId: string,
  ) => Promise<void>;

  logout: () => Promise<void>;

  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  shop: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username, password, shopId) => {
    const response = await apiClient.post('/auth/login', {
      username,
      password,
      shopId,
    });

    const { accessToken, refreshToken, user, shop } = response.data.data;

    // Enforce employee-only mobile access
    if (user.role !== 'employee' || !user.isMobileOnly) {
      throw new Error('Only employees with mobile access can log in to this app.');
    }

    await Promise.all([
      setToken(accessToken),
      setRefreshToken(refreshToken),
      setShopId(shopId),
    ]);

    set({
      user,
      shop,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  logout: async () => {
    try {
      // Best-effort server-side logout
      const { getRefreshToken } = await import('../lib/storage');
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken }).catch(() => {});
      }
    } finally {
      await clearAll();
      set({
        user: null,
        shop: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  restoreSession: async () => {
    try {
      const [token, shopId] = await Promise.all([getToken(), getShopId()]);

      if (!token || !shopId) {
        set({ isLoading: false });
        return;
      }

      // Validate the token by calling /auth/me
      const response = await apiClient.get('/auth/me');
      const currentUser = response.data.data;

      // Verify it's an employee
      if (currentUser.role !== 'employee') {
        await clearAll();
        set({ isLoading: false });
        return;
      }

      set({
        user: {
          id: currentUser.userId,
          username: currentUser.username,
          fullName: currentUser.fullName ?? currentUser.username,
          role: currentUser.role,
          isMobileOnly: currentUser.isMobileOnly ?? true,
        },
        shop: { id: shopId, name: currentUser.shopName ?? '', code: currentUser.shopCode ?? '' },
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      await clearAll();
      set({
        user: null,
        shop: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
}));
