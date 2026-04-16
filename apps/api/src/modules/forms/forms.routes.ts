import type { FastifyInstance } from 'fastify';
import { formsController } from './forms.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import {
  createDefinitionSchema,
  updateDefinitionSchema,
  createFieldSchema,
  updateFieldSchema,
  reorderFieldsSchema,
} from './forms.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function formRoutes(app: FastifyInstance) {
  const adminOnly = [authenticate, authorize([UserRole.ADMIN])];
  const anyAuth = [authenticate];

  // List all form definitions (admin)
  app.get('/definitions', { preHandler: adminOnly }, formsController.listDefinitions);

  // Get definition by form name (any auth — frontend needs this to render forms)
  app.get('/definitions/:formName', { preHandler: anyAuth }, formsController.getDefinitionByName as any);

  // Get definition by ID (admin)
  app.get('/definitions/id/:id', { preHandler: adminOnly }, formsController.getDefinitionById as any);

  // Create definition (admin)
  app.post('/definitions', {
    preHandler: [...adminOnly, validate(createDefinitionSchema)],
  }, formsController.createDefinition as any);

  // Update definition (admin)
  app.put('/definitions/:id', {
    preHandler: [...adminOnly, validate(updateDefinitionSchema)],
  }, formsController.updateDefinition as any);

  // Get fields for a definition (any auth)
  app.get('/definitions/:id/fields', { preHandler: anyAuth }, formsController.getFields as any);

  // Add field to a definition (admin)
  app.post('/definitions/:id/fields', {
    preHandler: [...adminOnly, validate(createFieldSchema)],
  }, formsController.addField as any);

  // Update a field (admin)
  app.put('/fields/:id', {
    preHandler: [...adminOnly, validate(updateFieldSchema)],
  }, formsController.updateField as any);

  // Delete a field (admin)
  app.delete('/fields/:id', { preHandler: adminOnly }, formsController.deleteField as any);

  // Reorder fields (admin)
  app.put('/definitions/:id/fields/reorder', {
    preHandler: [...adminOnly, validate(reorderFieldsSchema)],
  }, formsController.reorderFields as any);
}
