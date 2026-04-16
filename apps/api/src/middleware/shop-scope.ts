import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Adds shop scoping to the request. Uses the shop from JWT token
 * or allows override via X-Shop-Id header (for admin/accountant shop switching).
 */
export async function shopScope(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  const headerShopId = request.headers['x-shop-id'] as string | undefined;

  // Admin and Accountant can switch shops via header
  if (headerShopId && (request.currentUser.role === 'admin' || request.currentUser.role === 'accountant')) {
    request.shopFilter = { shopId: headerShopId };
  } else {
    request.shopFilter = { shopId: request.currentUser.shopId };
  }
}
