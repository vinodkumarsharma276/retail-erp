import type { FastifyInstance } from 'fastify';
import { installmentsController } from './installments.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { recordPaymentSchema, rescheduleSchema } from './installments.validation.js';
import { UserRole } from '@retailerp/shared-types';

export async function installmentRoutes(app: FastifyInstance) {
  // Admin + Accountant with shop scope
  const adminAccountantShopScoped = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
    shopScope,
  ];

  // Admin + Accountant + Employee with shop scope (for collections and payments)
  const collectionRoles = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EMPLOYEE]),
    shopScope,
  ];

  // Admin + Accountant only (no shop scope needed for detail views by ID)
  const adminAccountant = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT]),
  ];

  // Admin + Accountant + Employee (for schedule detail by ID)
  const adminAccountantEmployee = [
    authenticate,
    authorize([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EMPLOYEE]),
  ];

  // List schedules (admin, accountant — shop-scoped)
  app.get('/', { preHandler: adminAccountantShopScoped }, installmentsController.listSchedules as any);

  // Get overdue installments (admin, accountant — shop-scoped)
  app.get('/overdue', { preHandler: adminAccountantShopScoped }, installmentsController.getOverdue as any);

  // Get collections for date range (admin, accountant, employee — shop-scoped)
  app.get('/collections/range', { preHandler: collectionRoles }, installmentsController.getCollectionsForDateRange as any);

  // Get today's collections (admin, accountant, employee — shop-scoped)
  app.get('/collections/today', { preHandler: collectionRoles }, installmentsController.getCollectionsToday as any);

  // Get collections for a specific date (admin, accountant, employee — shop-scoped)
  app.get('/collections/date/:date', { preHandler: collectionRoles }, installmentsController.getCollectionsForDate as any);

  // Search installment schedules (admin, accountant, employee — shop-scoped)
  app.get('/search', { preHandler: collectionRoles }, installmentsController.searchSchedules as any);

  // Get schedule detail (admin, accountant, employee)
  app.get('/:scheduleId', { preHandler: adminAccountantEmployee }, installmentsController.getScheduleDetail as any);

  // Get timeline (admin, accountant)
  app.get('/:scheduleId/timeline', { preHandler: adminAccountant }, installmentsController.getTimeline as any);

  // Record payment (admin, accountant, employee — the main action)
  app.post('/:installmentId/pay', {
    preHandler: [...collectionRoles, validate(recordPaymentSchema)],
  }, installmentsController.recordPayment as any);

  // Reschedule (admin, accountant only)
  app.post('/:installmentId/reschedule', {
    preHandler: [...adminAccountantShopScoped, validate(rescheduleSchema)],
  }, installmentsController.reschedule as any);

  // Roll log (audit trail for a schedule — admin, accountant, employee)
  app.get('/:scheduleId/roll-log', { preHandler: adminAccountantEmployee }, installmentsController.getRollLog as any);

  // Admin: manually trigger the rollover engine across all active schedules (owner, admin)
  app.post('/admin/run-rollover', {
    preHandler: [
      authenticate,
      authorize([UserRole.OWNER, UserRole.ADMIN]),
    ],
  }, installmentsController.runRollover as any);
}
