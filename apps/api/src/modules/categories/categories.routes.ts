import type { FastifyInstance } from 'fastify';
import { categoriesController } from './categories.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import {
  createCategorySchema,
  updateCategorySchema,
  createAttributeSchema,
  updateAttributeSchema,
} from './categories.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function categoryRoutes(app: FastifyInstance) {
  const adminOnly = [authenticate, authorize([UserRole.ADMIN])];
  const anyAuth = [authenticate];

  // Category CRUD
  app.get('/', { preHandler: anyAuth }, categoriesController.getTree);

  app.get('/:id', { preHandler: anyAuth }, categoriesController.getById as any);

  app.post('/', {
    preHandler: [...adminOnly, validate(createCategorySchema)],
  }, categoriesController.create as any);

  app.put('/:id', {
    preHandler: [...adminOnly, validate(updateCategorySchema)],
  }, categoriesController.update as any);

  app.delete('/:id', { preHandler: adminOnly }, categoriesController.softDelete as any);

  // Category Attributes
  app.get('/:id/attributes', { preHandler: anyAuth }, categoriesController.getAttributes as any);

  app.post('/:id/attributes', {
    preHandler: [...adminOnly, validate(createAttributeSchema)],
  }, categoriesController.addAttribute as any);

  app.put('/:id/attributes/:attrId', {
    preHandler: [...adminOnly, validate(updateAttributeSchema)],
  }, categoriesController.updateAttribute as any);

  app.delete('/:id/attributes/:attrId', {
    preHandler: adminOnly,
  }, categoriesController.deleteAttribute as any);
}
