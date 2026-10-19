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

  /**
   * GET /api/v1/lookup/brands?categoryId=<uuid>
   *
   * The brands worth offering for a category: the ones its "brand" attribute
   * lists, plus the ones already on stock in it. The second half is what
   * makes the list keep itself — a brand typed in once for a new make is
   * offered from then on, with nobody having to curate a master list.
   */
  app.get<{ Querystring: { categoryId?: string } }>(
    '/brands',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const categoryId = (request.query.categoryId ?? '').trim();
      if (!categoryId) return sendSuccess(reply, []);

      const [attribute, used] = await Promise.all([
        prisma.categoryAttribute.findFirst({
          where: { categoryId, attributeName: 'brand' },
          select: { options: true },
        }),
        prisma.product.findMany({
          where: { categoryId },
          select: { brand: true },
          distinct: ['brand'],
          take: 500,
        }),
      ]);

      // Case-insensitively unique, keeping the spelling seen first so the
      // category's own list wins over however it was typed on a product.
      const seen = new Map<string, string>();
      const add = (value: unknown) => {
        const text = String(value ?? '').trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (!seen.has(key)) seen.set(key, text);
      };

      const listed = attribute?.options;
      if (Array.isArray(listed)) {
        for (const option of listed) {
          add(option !== null && typeof option === 'object'
            ? (option as Record<string, unknown>).value ?? (option as Record<string, unknown>).label
            : option);
        }
      }
      for (const row of used) add(row.brand);

      const brands = Array.from(seen.values()).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      );

      return sendSuccess(reply, brands);
    },
  );
}
