# Module templates

Replace `widgets` / `Widget` / `widget` with the module name. Modelled on
`apps/api/src/modules/expenses/` — when in doubt, copy from there.

## `widgets.validation.ts`

```ts
import { z } from 'zod';

export const createWidgetSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().positive('Amount must be positive'),
  notes: z.string().nullable().optional(),
});

export const updateWidgetSchema = createWidgetSchema.partial();
```

## `widgets.service.ts`

```ts
import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

// Tenant filtering/stamping is automatic (config/database.ts) for models with `tenantId`.
// Shop filtering is NOT — always apply the scope passed in.
export const widgetsService = {
  async list(
    scope: { shopId: string; shopIds?: string[] },
    filters: { skip: number; take: number; search?: string },
  ) {
    const where: Prisma.WidgetWhereInput =
      scope.shopIds && scope.shopIds.length > 0
        ? { shopId: { in: scope.shopIds } }
        : { shopId: scope.shopId };

    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    const [widgets, totalItems] = await Promise.all([
      prisma.widget.findMany({ where, orderBy: { createdAt: 'desc' }, skip: filters.skip, take: filters.take }),
      prisma.widget.count({ where }),
    ]);
    return { widgets, totalItems };
  },

  async getById(id: string) {
    return prisma.widget.findUnique({ where: { id } });
  },

  async create(shopId: string, data: { name: string; amount: number; notes?: string | null }, userId: string) {
    return prisma.widget.create({ data: { ...data, shopId, createdBy: userId } as any });
  },
};
```

## `widgets.controller.ts`

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { widgetsService } from './widgets.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const widgetsController = {
  async list(
    request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string; search?: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const { widgets, totalItems } = await widgetsService.list(
        { shopId, shopIds: allShops ? shopIds : undefined },
        { skip, take, search: request.query.search },
      );
      return sendPaginated(reply, widgets, { page, pageSize, totalItems });
    } catch (error) {
      return sendError(reply, error instanceof Error ? error.message : 'Failed to fetch widgets', 500);
    }
  },

  async getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const widget = await widgetsService.getById(request.params.id);
      if (!widget) return sendError(reply, 'Widget not found', 404);
      return sendSuccess(reply, widget);
    } catch (error) {
      return sendError(reply, error instanceof Error ? error.message : 'Failed to fetch widget', 500);
    }
  },

  async create(
    request: FastifyRequest<{ Body: { name: string; amount: number; notes?: string | null } }>,
    reply: FastifyReply,
  ) {
    try {
      const widget = await widgetsService.create(
        request.shopFilter!.shopId,
        request.body,
        request.currentUser!.userId,
      );
      return sendSuccess(reply, widget, 201);
    } catch (error) {
      return sendError(reply, error instanceof Error ? error.message : 'Failed to create widget', 500);
    }
  },
};
```

## `widgets.routes.ts`

```ts
import type { FastifyInstance } from 'fastify';
import { widgetsController } from './widgets.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createWidgetSchema } from './widgets.validation.js';

export async function widgetRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('widgets.list')] }, widgetsController.list as any);

  app.get('/:id', { preHandler: [authenticate, shopScope, requirePermission('widgets.detail')] }, widgetsController.getById as any);

  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('widgets.create'), validate(createWidgetSchema)],
  }, widgetsController.create as any);
}
```

## Registration in `apps/api/src/app.ts`

```ts
import { widgetRoutes } from './modules/widgets/widgets.routes.js';
// … in buildApp(), next to the other modules:
await registerGated(app, widgetRoutes, '/api/v1/widgets', FeatureKey.SOME_FEATURE);
// or, always on:
await app.register(widgetRoutes, { prefix: '/api/v1/widgets' });
```

## Permission group in `packages/shared-types/src/permissions.ts`

```ts
g('widgets', 'Widgets', [
  ['widgets.list', 'Open widget list'],
  ['widgets.detail', 'Open widget detail'],
  ['widgets.create', 'Create widget'],
]),
```
