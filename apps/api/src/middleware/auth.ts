import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ success: false, error: 'Authentication required' });
    }

    const decoded = await request.server.jwt.verify<{
      userId: string;
      username: string;
      role: string;
      /**
       * Owning tenant of the user — must match the resolved request tenant
       * to prevent a stolen token from one subdomain being replayed on
       * another. Defense in depth on top of `User(tenantId, username)`
       * uniqueness.
       */
      tenantId: string;
      shopId: string;
      isMobileOnly: boolean;
    }>(token);

    // Tenant binding check: every per-tenant route runs through
    // tenantResolver first, which sets request.tenant. If the JWT was
    // issued for a different tenant, refuse.
    if (request.tenant && decoded.tenantId && decoded.tenantId !== request.tenant.id) {
      return reply.status(403).send({
        success: false,
        error: 'Token does not belong to this tenant',
      });
    }

    request.currentUser = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role as any,
      tenantId: decoded.tenantId,
      shopId: decoded.shopId,
      isMobileOnly: decoded.isMobileOnly,
    };
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}
