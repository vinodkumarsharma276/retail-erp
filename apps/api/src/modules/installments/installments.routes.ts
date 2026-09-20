import type { FastifyInstance } from 'fastify';
import { installmentsController } from './installments.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/rbac.js';
import { shopScope } from '../../middleware/shop-scope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/permissions.js';
import {
  recordPaymentSchema,
  finalSettlementSchema,
  applyInterestSchema,
  rollbackInterestSchema,
  movePaymentSchema,
  correctPaymentSchema,
} from './installments.validation.js';
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

  // Get paid installments for a date range (admin, accountant — shop-scoped)
  app.get('/collections/paid-range', { preHandler: adminAccountantShopScoped }, installmentsController.getPaidCollectionsForDateRange as any);

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

  // Roll log (audit trail for a schedule — admin, accountant, employee)
  app.get('/:scheduleId/roll-log', { preHandler: adminAccountantEmployee }, installmentsController.getRollLog as any);

  // Revert a payment (admin only)
  app.post('/payments/:paymentId/revert', {
    preHandler: [...adminAccountantShopScoped],
  }, installmentsController.revertPayment as any);

  // Move a mis-recorded payment to the correct installment (admin, accountant)
  app.post('/payments/:paymentId/move', {
    preHandler: [...adminAccountantShopScoped, validate(movePaymentSchema)],
  }, installmentsController.movePayment as any);

  // Correct a payment recorded with the wrong (higher) amount (admin, accountant)
  app.post('/payments/:paymentId/correct', {
    preHandler: [...adminAccountantShopScoped, validate(correctPaymentSchema)],
  }, installmentsController.correctPayment as any);

  // ---- Final settlement (early closure) ----------------------------------
  app.get(
    '/schedules/:scheduleId/settlement-quote',
    { preHandler: [...adminAccountantEmployee, requirePermission('installments.detail')] },
    installmentsController.getSettlementQuote as any,
  );
  app.post(
    '/schedules/:scheduleId/final-settlement',
    {
      preHandler: [
        ...collectionRoles,
        requirePermission('installments.final_settlement'),
        validate(finalSettlementSchema),
      ],
    },
    installmentsController.recordFinalSettlement as any,
  );

  // ---- Overdue interest accrual + apply / rollback -----------------------
  app.get(
    '/schedules/:scheduleId/interest-accrual',
    { preHandler: [...adminAccountantEmployee, requirePermission('installments.detail')] },
    installmentsController.getInterestAccrual as any,
  );
  app.post(
    '/:installmentId/apply-interest',
    {
      preHandler: [
        ...collectionRoles,
        requirePermission('installments.interest.apply'),
        validate(applyInterestSchema),
      ],
    },
    installmentsController.applyOverdueInterest as any,
  );
  app.post(
    '/interest-applications/:applicationId/rollback',
    {
      preHandler: [
        ...adminAccountantShopScoped,
        requirePermission('installments.interest.rollback'),
        validate(rollbackInterestSchema),
      ],
    },
    installmentsController.rollbackInterestApplication as any,
  );
}
