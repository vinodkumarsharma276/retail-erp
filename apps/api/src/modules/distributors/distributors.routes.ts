import type { FastifyInstance } from 'fastify';
import { distributorsController } from './distributors.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import {
  createDistributorSchema,
  updateDistributorSchema,
  lumpsumPaymentSchema,
  deleteDistributorsSchema,
  mergeDistributorsSchema,
} from './distributors.validation.js';

export async function distributorRoutes(app: FastifyInstance) {

  // List distributors (paginated, searchable)
  app.get('/', { preHandler: [authenticate, requirePermission('distributors.list')] }, distributorsController.list as any);

  // Create distributor
  app.post('/', {
    preHandler: [authenticate, requirePermission('distributors.create'), validate(createDistributorSchema)],
  }, distributorsController.create as any);

  // Get single distributor
  app.get('/:id', { preHandler: [authenticate, requirePermission('distributors.detail')] }, distributorsController.getById as any);

  // Update distributor
  app.put('/:id', {
    preHandler: [authenticate, requirePermission('distributors.edit'), validate(updateDistributorSchema)],
  }, distributorsController.update as any);

  // Delete distributors. One id or many arrive the same way, so the screen's
  // single-row delete and its tick-several-off delete share a route.
  app.post('/delete', {
    preHandler: [authenticate, requirePermission('distributors.delete'), validate(deleteDistributorsSchema)],
  }, distributorsController.remove as any);

  // Fold duplicates into one supplier. Separate from plain delete: this one
  // moves purchases and stock rather than refusing to touch them.
  app.post('/merge', {
    preHandler: [authenticate, requirePermission('distributors.merge'), validate(mergeDistributorsSchema)],
  }, distributorsController.merge as any);

  // Get products from this distributor
  app.get('/:id/products', { preHandler: [authenticate, requirePermission('distributors.detail')] }, distributorsController.getProducts as any);

  // Record lumpsum payment for this distributor
  app.post('/:id/payments', {
    preHandler: [authenticate, requirePermission('purchases.record_payment'), validate(lumpsumPaymentSchema)],
  }, distributorsController.recordLumpsumPayment as any);

  // Get payment history for this distributor
  app.get('/:id/payments', { preHandler: [authenticate, requirePermission('distributors.detail')] }, distributorsController.getPayments as any);
}
