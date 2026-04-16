import type { FastifyInstance } from 'fastify';
import { employeesController } from './employees.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { createEmployeeSchema, updateEmployeeSchema } from './employees.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function employeeRoutes(app: FastifyInstance) {
  const adminShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN]),
    shopScope,
  ];

  // List employees (admin, shop-scoped, paginated)
  app.get('/', { preHandler: adminShopScoped }, employeesController.list as any);

  // Create employee (admin, shop-scoped)
  app.post('/', {
    preHandler: [...adminShopScoped, validate(createEmployeeSchema)],
  }, employeesController.create as any);

  // Get employee by ID (admin)
  app.get('/:id', { preHandler: adminShopScoped }, employeesController.getById as any);

  // Update employee (admin)
  app.put('/:id', {
    preHandler: [...adminShopScoped, validate(updateEmployeeSchema)],
  }, employeesController.update as any);
}
