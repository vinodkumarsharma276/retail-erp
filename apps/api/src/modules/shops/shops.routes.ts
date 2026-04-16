import type { FastifyInstance } from 'fastify';
import { shopsController } from './shops.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { updateShopSchema } from './shops.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function shopRoutes(app: FastifyInstance) {
  // All routes require authentication + admin role
  app.get('/', {
    preHandler: [authenticate, authorize([UserRole.ADMIN])],
  }, shopsController.list);

  app.get('/:id', {
    preHandler: [authenticate, authorize([UserRole.ADMIN])],
  }, shopsController.getById as any);

  app.put('/:id', {
    preHandler: [authenticate, authorize([UserRole.ADMIN]), validate(updateShopSchema)],
  }, shopsController.update as any);
}
