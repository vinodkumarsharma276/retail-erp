import type { FastifyInstance } from 'fastify';
import { expensesController } from './expenses.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createExpenseSchema, updateExpenseSchema } from './expenses.validation.js';

export async function expenseRoutes(app: FastifyInstance) {

  // List expenses (paginated, filtered, shop-scoped)
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('expenses.list')] }, expensesController.list as any);

  // Get expense summary (aggregated by category)
  app.get('/summary', { preHandler: [authenticate, shopScope, requirePermission('expenses.list')] }, expensesController.getSummary as any);

  // Create expense
  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('expenses.create'), validate(createExpenseSchema)],
  }, expensesController.create as any);

  // Get single expense
  app.get('/:id', { preHandler: [authenticate, shopScope, requirePermission('expenses.detail')] }, expensesController.getById as any);

  // Update expense
  app.put('/:id', {
    preHandler: [authenticate, shopScope, requirePermission('expenses.edit'), validate(updateExpenseSchema)],
  }, expensesController.update as any);

  // Delete expense (admin only)
  app.delete('/:id', { preHandler: [authenticate, shopScope, requirePermission('expenses.delete')] }, expensesController.delete as any);
}
