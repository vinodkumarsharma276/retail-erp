import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@retailerp/shared-types';

/**
 * Creates a middleware that restricts access to specified roles. Owner is
 * implicitly allowed everywhere — they manage roles and have full access.
 */
export function authorize(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      return reply.status(401).send({ success: false, error: 'Authentication required' });
    }

    if (request.currentUser.role === UserRole.OWNER) return; // Owner bypasses all checks

    if (!allowedRoles.includes(request.currentUser.role)) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions' });
    }
  };
}

/**
 * Blocks mobile-only users from accessing web-only routes.
 */
export async function webOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.currentUser?.isMobileOnly) {
    return reply
      .status(403)
      .send({ success: false, error: 'Access denied. Please use the mobile app.' });
  }
}
