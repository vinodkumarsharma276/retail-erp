import type { FastifyInstance } from 'fastify';
import { expensesController } from './expenses.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createExpenseSchema, updateExpenseSchema } from './expenses.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function expenseRoutes(app: FastifyInstance) {
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  const adminOnly = [
    authenticate,
    authorize([UserRole.ADMIN]),
    shopScope,
  ];

  // List expenses (paginated, filtered, shop-scoped)
  app.get('/', { preHandler: adminAccountant }, expensesController.list as any);

  // Get expense summary (aggregated by category)
  app.get('/summary', { preHandler: adminAccountant }, expensesController.getSummary as any);

  // Create expense
  app.post('/', {
    preHandler: [...adminAccountant, validate(createExpenseSchema)],
  }, expensesController.create as any);

  // Get single expense
  app.get('/:id', { preHandler: adminAccountant }, expensesController.getById as any);

  // Update expense
  app.put('/:id', {
    preHandler: [...adminAccountant, validate(updateExpenseSchema)],
  }, expensesController.update as any);

  // Delete expense (admin only)
  app.delete('/:id', { preHandler: adminOnly }, expensesController.delete as any);
}
