/**
 * Platform admin authentication middleware. Validates the bearer token
 * against the SEPARATE `PlatformUser` identity store (NOT the per-tenant
 * `User` table). Used exclusively by `/api/v1/platform/*` routes.
 *
 * Platform admin JWTs carry a `scope: 'platform'` claim that the tenant
 * `authenticate` middleware does NOT recognise, so the two token kinds
 * cannot be confused.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function platformAuthenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ success: false, error: 'Authentication required' });
    }

    const decoded = await request.server.jwt.verify<{
      platformUserId: string;
      username: string;
      scope?: string;
    }>(token);

    // Reject tenant tokens (no scope claim, or scope !== 'platform').
    if (decoded.scope !== 'platform') {
      return reply.status(403).send({
        success: false,
        error: 'Platform admin token required',
      });
    }

    request.platformUser = {
      platformUserId: decoded.platformUserId,
      username: decoded.username,
    };
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}
