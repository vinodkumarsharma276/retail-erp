/**
 * Helpers for building tenant-aware Prisma filters from a request context.
 * Centralises the `{ tenantId, shopId / shopIds }` boilerplate so service
 * code stays compact and consistent.
 *
 * Usage:
 *   import { tenantScope } from '../../utils/tenant-scope.js';
 *
 *   const scope = tenantScope(request);
 *   await prisma.product.findMany({
 *     where: { ...scope.shopWhere() },
 *   });
 */
import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';

/**
 * Discriminated union returned by `tenantScope(request)`. Always carries
 * the resolved `tenantId`; the shop side is either a single shop or
 * an aggregate "All Shops" view.
 */
export type TenantShopScope =
  | {
      tenantId: string;
      mode: 'single';
      shopId: string;
      shopIds?: undefined;
      /** Prisma `{ tenantId, shopId }` filter shorthand. */
      shopWhere(): { tenantId: string; shopId: string };
      /** Prisma `{ tenantId }` filter shorthand (when no shop scoping is needed). */
      tenantWhere(): { tenantId: string };
    }
  | {
      tenantId: string;
      mode: 'all_shops';
      /** The "primary" shop id from the JWT; rarely needed in this mode. */
      shopId: string;
      shopIds: string[];
      shopWhere(): { tenantId: string; shopId: { in: string[] } };
      tenantWhere(): { tenantId: string };
    };

/**
 * Build a TenantShopScope from a Fastify request. Throws synchronously if
 * the request lacks the required middleware context — services should
 * never receive a request without tenant + shopFilter set, so this throw
 * is treated as a programming error and surfaces a 500.
 */
export function tenantScope(request: FastifyRequest): TenantShopScope {
  const filter = request.shopFilter;
  if (!filter) {
    throw new Error('tenantScope: request has no shopFilter — wire shopScope middleware');
  }
  const tenantId = filter.tenantId;
  if (!tenantId) {
    throw new Error('tenantScope: shopFilter.tenantId missing — wire tenantResolver middleware');
  }

  if (filter.allShops && filter.shopIds && filter.shopIds.length > 0) {
    const shopIds = filter.shopIds;
    const shopId = filter.shopId;
    return {
      tenantId,
      mode: 'all_shops',
      shopId,
      shopIds,
      shopWhere: () => ({ tenantId, shopId: { in: shopIds } }),
      tenantWhere: () => ({ tenantId }),
    };
  }
  const shopId = filter.shopId;
  return {
    tenantId,
    mode: 'single',
    shopId,
    shopWhere: () => ({ tenantId, shopId }),
    tenantWhere: () => ({ tenantId }),
  };
}

/**
 * Lightweight variant for cases where the caller has only the request's
 * tenant context (e.g. read-only platform-style queries inside a tenant).
 * Throws if tenant context is missing.
 */
export function tenantOnlyWhere(request: FastifyRequest): { tenantId: string } {
  const tenantId = request.tenant?.id ?? request.currentUser?.tenantId;
  if (!tenantId) {
    throw new Error('tenantOnlyWhere: no tenant context on request');
  }
  return { tenantId };
}

/**
 * Type-only helper: assert a Prisma `where` clause carries `tenantId`.
 * Use in service tests to lock down that a query path is tenant-scoped.
 */
export type WithTenant<T extends Prisma.ProductWhereInput | Record<string, unknown>> = T & {
  tenantId: string | { in: string[] } | { equals: string };
};
