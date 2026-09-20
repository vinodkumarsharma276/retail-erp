/**
 * Platform admin — operator of the SaaS itself (separate from any tenant).
 * Lives in its own table `platform_users` so the auth flow and table
 * relationships are completely isolated from per-tenant users.
 */
export interface PlatformUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  /** Optional second-factor enrolment. Reserved for future MFA support. */
  totpSecret: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** JWT payload for a platform admin session (vs the tenant user payload). */
export interface PlatformJwtPayload {
  platformUserId: string;
  username: string;
  /** Marker so the auth middleware can tell tenant vs platform tokens apart. */
  scope: 'platform';
  iat?: number;
  exp?: number;
}
