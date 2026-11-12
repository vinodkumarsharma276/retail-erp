import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { sendSuccess } from '../../utils/response.js';
import { catalogService } from '../catalog/catalog.service.js';

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

  /**
   * GET /api/v1/lookup/brands?categoryId=<uuid>
   *
   * The makes sold under a product type (with its parent and sub-types): the
   * Product type → Brand catalog, the type's own brand list and makes on
   * stock. The catalog keeps itself: a make saved once is offered from then on.
   */
  app.get<{ Querystring: { categoryId?: string } }>(
    '/brands',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const categoryId = (request.query.categoryId ?? '').trim();
      return sendSuccess(reply, categoryId ? await catalogService.brands(categoryId) : []);
    },
  );

  /**
   * GET /api/v1/lookup/models?categoryId=<uuid>&brand=<text>
   *
   * Model numbers of one make within a product type (Cooler → SYMPHONY →
   * its models). Misspelt makes are matched as the brand they stand for.
   */
  app.get<{ Querystring: { categoryId?: string; brand?: string } }>(
    '/models',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const categoryId = (request.query.categoryId ?? '').trim();
      const brand = (request.query.brand ?? '').trim();
      return sendSuccess(reply, categoryId && brand ? await catalogService.models(categoryId, brand) : []);
    },
  );
}