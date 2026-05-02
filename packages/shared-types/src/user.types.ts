import { UserRole } from './enums';
import type { UserPreferences } from './preferences.types';

export interface User {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  phone: string;
  role: UserRole;
  isMobileOnly: boolean;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  preferences?: UserPreferences | null;
}

export interface UserShop {
  id: string;
  userId: string;
  shopId: string;
  isPrimary: boolean;
}

export interface AuthTokenPayload {
  userId: string;
  username: string;
  role: UserRole;
  shopId: string;
  isMobileOnly: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: Omit<User, 'createdAt' | 'updatedAt'>;
  shop: { id: string; name: string; code: string };
}
