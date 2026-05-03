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
      /**
       * The "primary" shop the request is operating against. Always set
       * (defaults to the user's currently-active shop) — modules that
       * haven't been adapted for All Shops mode keep using this and
       * continue to work as a single-shop view.
       */
      shopId: string;
      /**
       * True when the user has chosen "All Shops" in the header dropdown
       * AND has the `shops.view_all` permission. Read-only modules that
       * have been adapted should branch on this flag and use `shopIds`
       * to query across the user's accessible shops.
       */
      allShops?: boolean;
      /**
       * The full set of shop IDs the user has access to. Populated only
       * when `allShops === true`.
       */
      shopIds?: string[];
    };
  }
}
