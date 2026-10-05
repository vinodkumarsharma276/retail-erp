import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { loadUsablePermissions } from './permissions.js';

/**
 * Sentinel value the frontend sends in the `X-Shop-Id` header when the
 * user has chosen "All Shops" in the header dropdown. UUIDs can never
 * collide with this string so it's safe as a marker.
 */
const ALL_SHOPS_SENTINEL = 'all';

/**
 * Adds shop scoping to the request. Uses the shop from the JWT token,
 * allows override via `X-Shop-Id` header (for owner/admin/accountant
 * shop switching), and supports `X-Shop-Id: all` for users who hold the
 * `shops.view_all` permission — which fans out to every shop the user
 * has access to.
 */
export async function shopScope(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }
  // Tenant context is required for any shop-scoped route. The auth middleware
  // already verified the JWT's tenantId matches request.tenant.id, but we
  // double-check here so service code can rely on shopFilter.tenantId being
  // present without an undefined check.
  const tenantId = request.tenant?.id ?? request.currentUser.tenantId;
  if (!tenantId) {
    return reply.status(400).send({
      success: false,
      error: 'No tenant context for shop-scoped request',
    });
  }

  const headerShopId = request.headers['x-shop-id'] as string | undefined;
  // Switching shops is a permission, not a role.
  const usable = await loadUsablePermissions(request.currentUser.userId, tenantId);
  const canSwitchShops = usable.has('shop.switch');

  // ── All-shops mode ──────────────────────────────────────────────────
  // Triggered only when the header is exactly "all", the user is allowed
  // to switch shops at all, and the user's role grants `shops.view_all`.
  // We resolve the user's accessible shops once and stash both the
  // sentinel "primary" shop (the JWT's shopId, used by legacy modules
  // that haven't been adapted) and the full `shopIds` array. The
  // UserShop lookup is constrained to the current tenant so the
  // aggregate view can never accidentally reach across tenants.
  if (headerShopId === ALL_SHOPS_SENTINEL && canSwitchShops) {
    const allowed = usable.has('shops.view_all') || usable.has('shop.view_all');

    if (allowed) {
      const userShops = await prisma.userShop.findMany({
        where: {
          userId: request.currentUser.userId,
          tenantId,
          shop: { isActive: true, tenantId },
        },
        select: { shopId: true },
      });
      const shopIds = userShops.map((us) => us.shopId);

      if (shopIds.length === 0) {
        return reply
          .status(403)
          .send({ success: false, error: 'You do not have access to any shop' });
      }

      request.shopFilter = {
        tenantId,
        shopId: request.currentUser.shopId,
        allShops: true,
        shopIds,
      };
      return;
    }
    // Permission missing — fall through to normal single-shop path.
  }

  // ── Normal single-shop mode ─────────────────────────────────────────
  if (headerShopId && canSwitchShops) {
    request.shopFilter = { tenantId, shopId: headerShopId };
  } else {
    request.shopFilter = { tenantId, shopId: request.currentUser.shopId };
  }

  const hasShopAccess = await prisma.userShop.findFirst({
    where: {
      userId: request.currentUser.userId,
      shopId: request.shopFilter.shopId,
      tenantId,
      shop: { isActive: true, tenantId },
    },
    select: { id: true },
  });

  if (!hasShopAccess) {
    return reply.status(403).send({ success: false, error: 'You do not have access to this shop' });
  }
}
