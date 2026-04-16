import type { FastifyInstance } from 'fastify';
import { usersController } from './users.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { createUserSchema, updateUserSchema, assignShopsSchema } from './users.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function userRoutes(app: FastifyInstance) {
  // All routes require authentication + admin role
  const adminOnly = [authenticate, authorize([UserRole.ADMIN])];

  app.get('/', { preHandler: adminOnly }, usersController.list as any);

  app.post('/', {
    preHandler: [...adminOnly, validate(createUserSchema)],
  }, usersController.create as any);

  app.get('/:id', { preHandler: adminOnly }, usersController.getById as any);

  app.put('/:id', {
    preHandler: [...adminOnly, validate(updateUserSchema)],
  }, usersController.update as any);

  app.delete('/:id', { preHandler: adminOnly }, usersController.delete as any);

  app.put('/:id/assign-shops', {
    preHandler: [...adminOnly, validate(assignShopsSchema)],
  }, usersController.assignShops as any);
}
