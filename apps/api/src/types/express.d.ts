import type { UserRole } from '@retailerp/shared-types';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: {
      userId: string;
      username: string;
      role: UserRole;
      shopId: string;
      isMobileOnly: boolean;
      permissions?: Set<string>;
      roleId?: string | null;
    };
    shopFilter?: {
      shopId: string;
    };
  }
}
