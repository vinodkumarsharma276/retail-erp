import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { sendSuccess } from '../../utils/response.js';

/**
 * Lookup endpoints — small read-only helpers that power autocomplete /
 * dropdown widgets shared across multiple modules. Available to any
 * authenticated user.
 */
export async function lookupRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/lookup/cities?q=<substr>
   * Returns a deduped, alphabetically sorted list of cities currently used
   * on Customer or Distributor records (across all shops). Optional `q`
   * query parameter does a case-insensitive prefix/substring filter.
   */
  app.get(
    '/cities',
    { preHandler: [authenticate] },
    async (
      request: FastifyRequest<{ Querystring: { q?: string } }>,
      reply: FastifyReply,
    ) => {
      const q = (request.query.q ?? '').trim();

      const customerWhere = q
        ? { city: { contains: q, mode: 'insensitive' as const } }
        : { city: { not: null } };
      const distributorWhere = q
        ? { city: { contains: q, mode: 'insensitive' as const } }
        : {};

      const [customerRows, distributorRows] = await Promise.all([
        prisma.customer.findMany({
          where: customerWhere,
          select: { city: true },
          distinct: ['city'],
          take: 500,
        }),
        prisma.distributor.findMany({
          where: distributorWhere,
          select: { city: true },
          distinct: ['city'],
          take: 500,
        }),
      ]);

      const set = new Set<string>();
      for (const r of customerRows) {
        if (r.city && r.city.trim().length > 0) set.add(r.city.trim());
      }
      for (const r of distributorRows) {
        if (r.city && r.city.trim().length > 0) set.add(r.city.trim());
      }

      const cities = Array.from(set).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      );

      return sendSuccess(reply, cities);
    },
  );
}
