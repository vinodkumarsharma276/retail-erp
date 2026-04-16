import type { UserRole } from '@retailerp/shared-types';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: {
      userId: string;
      username: string;
      role: UserRole;
      shopId: string;
      isMobileOnly: boolean;
    };
    shopFilter?: {
      shopId: string;
    };
  }
}
