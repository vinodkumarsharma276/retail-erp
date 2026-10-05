import type { FastifyInstance } from 'fastify';
import { formsController } from './forms.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import {
  createDefinitionSchema,
  updateDefinitionSchema,
  createFieldSchema,
  updateFieldSchema,
  reorderFieldsSchema,
} from './forms.validation.js';

export async function formRoutes(app: FastifyInstance) {

  // List all form definitions (admin)
  app.get('/definitions', { preHandler: [authenticate, requirePermission('forms.view')] }, formsController.listDefinitions);

  // Get definition by form name (any auth — frontend needs this to render forms)
  app.get('/definitions/:formName', { preHandler: [authenticate] }, formsController.getDefinitionByName as any);

  // Get definition by ID (admin)
  app.get('/definitions/id/:id', { preHandler: [authenticate, requirePermission('forms.view')] }, formsController.getDefinitionById as any);

  // Create definition (admin)
  app.post('/definitions', {
    preHandler: [authenticate, requirePermission('forms.edit_definitions'), validate(createDefinitionSchema)],
  }, formsController.createDefinition as any);

  // Update definition (admin)
  app.put('/definitions/:id', {
    preHandler: [authenticate, requirePermission('forms.edit_definitions'), validate(updateDefinitionSchema)],
  }, formsController.updateDefinition as any);

  // Get fields for a definition (any auth)
  app.get('/definitions/:id/fields', { preHandler: [authenticate] }, formsController.getFields as any);

  // Add field to a definition (admin)
  app.post('/definitions/:id/fields', {
    preHandler: [authenticate, requirePermission('forms.add_field'), validate(createFieldSchema)],
  }, formsController.addField as any);

  // Update a field (admin)
  app.put('/fields/:id', {
    preHandler: [authenticate, requirePermission('forms.edit_definitions'), validate(updateFieldSchema)],
  }, formsController.updateField as any);

  // Delete a field (admin)
  app.delete('/fields/:id', { preHandler: [authenticate, requirePermission('forms.delete_field')] }, formsController.deleteField as any);

  // Reorder fields (admin)
  app.put('/definitions/:id/fields/reorder', {
    preHandler: [authenticate, requirePermission('forms.edit_definitions'), validate(reorderFieldsSchema)],
  }, formsController.reorderFields as any);
}
