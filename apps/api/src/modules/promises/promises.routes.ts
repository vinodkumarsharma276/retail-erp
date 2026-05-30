import type { FastifyInstance } from 'fastify';
import { UserRole } from '@retailerp/shared-types';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { promisesController } from './promises.controller.js';
import { createPromiseSchema } from './promises.validation.js';

export async function promisesRoutes(app: FastifyInstance) {
  const collectionRoles = [
    authenticate,
    authorize([UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EMPLOYEE]),
    shopScope,
  ];

  const adminAccountant = [
    authenticate,
    authorize([UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  app.post('/', {
    preHandler: [...collectionRoles, validate(createPromiseSchema)],
  }, promisesController.create as any);

  app.get('/', {
    preHandler: collectionRoles,
  }, promisesController.list as any);

  app.delete('/:id', {
    preHandler: adminAccountant,
  }, promisesController.cancel as any);
}
