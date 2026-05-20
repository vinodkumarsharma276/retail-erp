import type { UserRole } from '@retailerp/shared-types';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Tenant resolved from the request (subdomain / X-Tenant-Slug header).
     * Set by `tenantResolver` middleware, which runs before auth on every
     * non-platform request. Always set for tenant-scoped routes; undefined
     * only on platform-admin and health endpoints.
     */
    tenant?: {
      id: string;
      slug: string;
      name: string;
      planId: string;
      status: string;
    };
    /**
     * Platform admin context — set only on `/api/v1/platform/*` routes by
     * the `platformAuthenticate` middleware. Mutually exclusive with
     * `currentUser` (per-tenant user) by convention.
     */
    platformUser?: {
      platformUserId: string;
      username: string;
    };
    currentUser?: {
      userId: string;
      username: string;
      role: UserRole;
      /** Owning tenant of the user — must match `request.tenant.id`. */
      tenantId: string;
      shopId: string;
      isMobileOnly: boolean;
      permissions?: Set<string>;
      roleId?: string | null;
    };
    shopFilter?: {
      /**
       * Owning tenant — copied from `request.tenant.id` for convenience so
       * service-layer code can build `{ tenantId, shopId }` filters without
       * reaching back into the request object.
       */
      tenantId: string;
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
       * when `allShops === true`. Always constrained to the current tenant.
       */
      shopIds?: string[];
    };
  }
}
