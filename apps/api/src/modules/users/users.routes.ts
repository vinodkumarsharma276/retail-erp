import type { FastifyInstance } from 'fastify';
import { usersController } from './users.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { createUserSchema, updateUserSchema, assignShopsSchema } from './users.validation.js';

export async function userRoutes(app: FastifyInstance) {
  // All routes require authentication + admin role

  app.get('/', { preHandler: [authenticate, requirePermission('users.list')] }, usersController.list as any);

  app.post('/', {
    preHandler: [authenticate, requirePermission('users.create'), validate(createUserSchema)],
  }, usersController.create as any);

  app.get('/:id', { preHandler: [authenticate, requirePermission('users.list')] }, usersController.getById as any);

  app.put('/:id', {
    preHandler: [authenticate, requirePermission('users.edit'), validate(updateUserSchema)],
  }, usersController.update as any);

  app.delete('/:id', { preHandler: [authenticate, requirePermission('users.deactivate')] }, usersController.delete as any);

  app.put('/:id/assign-shops', {
    preHandler: [authenticate, requirePermission('users.assign_to_shops'), validate(assignShopsSchema)],
  }, usersController.assignShops as any);
}
