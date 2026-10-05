import type { FastifyInstance } from 'fastify';
import { employeesController } from './employees.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createEmployeeSchema, updateEmployeeSchema } from './employees.validation.js';

export async function employeeRoutes(app: FastifyInstance) {

  // List employees (admin, shop-scoped, paginated)
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('employees.list')] }, employeesController.list as any);

  // Create employee (admin, shop-scoped)
  app.post('/', {
    preHandler: [authenticate, shopScope, requirePermission('employees.create'), validate(createEmployeeSchema)],
  }, employeesController.create as any);

  // Get employee by ID (admin)
  app.get('/:id', { preHandler: [authenticate, shopScope, requirePermission('employees.list')] }, employeesController.getById as any);

  // Update employee (admin)
  app.put('/:id', {
    preHandler: [authenticate, shopScope, requirePermission('employees.edit'), validate(updateEmployeeSchema)],
  }, employeesController.update as any);
}
