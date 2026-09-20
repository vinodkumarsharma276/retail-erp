import type { FastifyInstance } from 'fastify';
import { distributorsController } from './distributors.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { createDistributorSchema, updateDistributorSchema, lumpsumPaymentSchema } from './distributors.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function distributorRoutes(app: FastifyInstance) {
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
  ];

  // List distributors (paginated, searchable)
  app.get('/', { preHandler: adminAccountant }, distributorsController.list as any);

  // Create distributor
  app.post('/', {
    preHandler: [...adminAccountant, validate(createDistributorSchema)],
  }, distributorsController.create as any);

  // Get single distributor
  app.get('/:id', { preHandler: adminAccountant }, distributorsController.getById as any);

  // Update distributor
  app.put('/:id', {
    preHandler: [...adminAccountant, validate(updateDistributorSchema)],
  }, distributorsController.update as any);

  // Get products from this distributor
  app.get('/:id/products', { preHandler: adminAccountant }, distributorsController.getProducts as any);

  // Record lumpsum payment for this distributor
  app.post('/:id/payments', {
    preHandler: [...adminAccountant, validate(lumpsumPaymentSchema)],
  }, distributorsController.recordLumpsumPayment as any);

  // Get payment history for this distributor
  app.get('/:id/payments', { preHandler: adminAccountant }, distributorsController.getPayments as any);
}
