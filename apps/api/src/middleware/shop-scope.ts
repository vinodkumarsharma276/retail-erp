import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { loadEffectivePermissionsForUser } from './permissions.js';

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

  const headerShopId = request.headers['x-shop-id'] as string | undefined;
  const canSwitchShops =
    request.currentUser.role === 'owner' ||
    request.currentUser.role === 'admin' ||
    request.currentUser.role === 'accountant';

  // ── All-shops mode ──────────────────────────────────────────────────
  // Triggered only when the header is exactly "all", the user is allowed
  // to switch shops at all, and the user's role grants `shops.view_all`.
  // We resolve the user's accessible shops once and stash both the
  // sentinel "primary" shop (the JWT's shopId, used by legacy modules
  // that haven't been adapted) and the full `shopIds` array.
  if (headerShopId === ALL_SHOPS_SENTINEL && canSwitchShops) {
    // Owner has every permission via the catalog; cheap fast path.
    let allowed = request.currentUser.role === 'owner';
    if (!allowed) {
      // Effective permissions also pick up any per-user grants/denies.
      const perms = await loadEffectivePermissionsForUser(request.currentUser.userId);
      allowed = perms.has('shops.view_all');
    }

    if (allowed) {
      const userShops = await prisma.userShop.findMany({
        where: {
          userId: request.currentUser.userId,
          shop: { isActive: true },
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
    request.shopFilter = { shopId: headerShopId };
  } else {
    request.shopFilter = { shopId: request.currentUser.shopId };
  }

  const hasShopAccess = await prisma.userShop.findFirst({
    where: {
      userId: request.currentUser.userId,
      shopId: request.shopFilter.shopId,
      shop: { isActive: true },
    },
    select: { id: true },
  });

  if (!hasShopAccess) {
    return reply.status(403).send({ success: false, error: 'You do not have access to this shop' });
  }
}
