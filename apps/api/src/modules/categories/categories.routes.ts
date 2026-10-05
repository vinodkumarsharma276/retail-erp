import type { FastifyInstance } from 'fastify';
import { categoriesController } from './categories.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import {
  createCategorySchema,
  updateCategorySchema,
  createAttributeSchema,
  updateAttributeSchema,
} from './categories.validation.js';

export async function categoryRoutes(app: FastifyInstance) {

  // Category CRUD
  app.get('/', { preHandler: [authenticate] }, categoriesController.getTree);

  app.get('/:id', { preHandler: [authenticate] }, categoriesController.getById as any);

  app.post('/', {
    preHandler: [authenticate, requirePermission('categories.create'), validate(createCategorySchema)],
  }, categoriesController.create as any);

  app.put('/:id', {
    preHandler: [authenticate, requirePermission('categories.edit'), validate(updateCategorySchema)],
  }, categoriesController.update as any);

  app.delete('/:id', { preHandler: [authenticate, requirePermission('categories.delete')] }, categoriesController.softDelete as any);

  // Category Attributes
  app.get('/:id/attributes', { preHandler: [authenticate] }, categoriesController.getAttributes as any);

  app.post('/:id/attributes', {
    preHandler: [authenticate, requirePermission('categories.edit_attributes'), validate(createAttributeSchema)],
  }, categoriesController.addAttribute as any);

  app.put('/:id/attributes/:attrId', {
    preHandler: [authenticate, requirePermission('categories.edit_attributes'), validate(updateAttributeSchema)],
  }, categoriesController.updateAttribute as any);

  app.delete('/:id/attributes/:attrId', {
    preHandler: [authenticate, requirePermission('categories.edit_attributes')],
  }, categoriesController.deleteAttribute as any);
}
