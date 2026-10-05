import type { FastifyInstance } from 'fastify';
import { customersController } from './customers.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createCustomerSchema, updateCustomerSchema } from './customers.validation.js';

export async function customerRoutes(app: FastifyInstance) {

  // List customers (admin, accountant, others — shop-scoped)
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('customers.list')] }, customersController.list as any);

  // Quick search across ALL shops (any authenticated user)
  app.get('/search', { preHandler: [authenticate, requireAnyPermission('customers.list', 'customers.detail')] }, customersController.search as any);

  // Tenant-scoped installment reliability metrics.
  app.get('/:id/reliability', { preHandler: [authenticate, requirePermission('installments.detail')] }, customersController.getReliability as any);

  // Create customer (admin, accountant, others — shop-scoped)
  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('customers.create'), validate(createCustomerSchema)],
  }, customersController.create as any);

  // Get single customer detail (admin, accountant, others)
  app.get('/:id', { preHandler: [authenticate, shopScope, requirePermission('customers.detail')] }, customersController.getById as any);

  // Update customer (admin, accountant only)
  app.put('/:id', {
    preHandler: [authenticate, shopScope, requirePermission('customers.edit'), validate(updateCustomerSchema)],
  }, customersController.update as any);

  // Get customer's sales (admin, accountant only)
  app.get('/:id/sales', { preHandler: [authenticate, requirePermission('customers.view_purchase_history')] }, customersController.getSales as any);

  // Installment reliability summary — any authenticated user can read to support
  // the Sale-create banner when selecting an existing customer.
  app.get(
    '/:id/installment-history',
    { preHandler: [authenticate, requireAnyPermission('installments.list', 'sales.create_self_finance')] },
    customersController.getInstallmentHistory as any,
  );
}
