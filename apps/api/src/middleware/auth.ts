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
      shopId: string;
      isMobileOnly: boolean;
    }>(token);

    request.currentUser = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role as any,
      shopId: decoded.shopId,
      isMobileOnly: decoded.isMobileOnly,
    };
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}
