import type { FastifyInstance } from 'fastify';
import { customersController } from './customers.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createCustomerSchema, updateCustomerSchema } from './customers.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function customerRoutes(app: FastifyInstance) {
  const allShopRoles = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OTHERS]),
    shopScope,
  ];

  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
  ];

  const adminAccountantShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  // List customers (admin, accountant, others — shop-scoped)
  app.get('/', { preHandler: allShopRoles }, customersController.list as any);

  // Quick search across ALL shops (any authenticated user)
  app.get('/search', { preHandler: [authenticate] }, customersController.search as any);

  // Create customer (admin, accountant, others — shop-scoped)
  app.post('/', {
    preHandler: [...allShopRoles, validate(createCustomerSchema)],
  }, customersController.create as any);

  // Get single customer detail (admin, accountant, others)
  app.get('/:id', { preHandler: allShopRoles }, customersController.getById as any);

  // Update customer (admin, accountant only)
  app.put('/:id', {
    preHandler: [...adminAccountantShopScoped, validate(updateCustomerSchema)],
  }, customersController.update as any);

  // Get customer's sales (admin, accountant only)
  app.get('/:id/sales', { preHandler: adminAccountant }, customersController.getSales as any);
}
