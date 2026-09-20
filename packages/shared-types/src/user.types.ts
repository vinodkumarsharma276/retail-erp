import { UserRole } from './enums';
import type { UserPreferences } from './preferences.types';
import type { TenantFeatureSnapshot } from './tenant.types';

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
  /** Owning tenant of the user — embedded in the JWT for cross-tenant defense. */
  tenantId: string;
  shopId: string;
  isMobileOnly: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

/** Lightweight tenant header returned by login / me — for header chrome + routing. */
export interface AuthTenantContext {
  id: string;
  slug: string;
  name: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: Omit<User, 'createdAt' | 'updatedAt'>;
  shop: { id: string; name: string; code: string };
  tenant: AuthTenantContext;
  features: TenantFeatureSnapshot;
  permissions?: string[];
}
