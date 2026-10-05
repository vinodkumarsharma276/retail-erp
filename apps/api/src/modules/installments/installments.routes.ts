import type { FastifyInstance } from 'fastify';
import { installmentsController } from './installments.controller.js';
import { authenticate } from '../../middleware/auth.js';
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
  penaltyPerDaySchema,
} from './installments.validation.js';

export async function installmentRoutes(app: FastifyInstance) {
  // Admin + Accountant with shop scope
  const adminAccountantShopScoped = [
    authenticate,
    shopScope,
  ];

  // Admin + Accountant + Employee with shop scope (for collections and payments)
  const collectionRoles = [
    authenticate,
    shopScope,
  ];

  // Admin + Accountant only (no shop scope needed for detail views by ID)

  // Admin + Accountant + Employee (for schedule detail by ID)
  const adminAccountantEmployee = [
    authenticate,
  ];

  // List schedules (admin, accountant — shop-scoped)
  app.get('/', { preHandler: [authenticate, shopScope, requirePermission('installments.list')] }, installmentsController.listSchedules as any);

  // Who to call on a given day — due today, promises due, broken promises,
  // overdue not covered by a later promise (admin, accountant, employee).
  app.get('/call-list', { preHandler: [authenticate, shopScope, requirePermission('installments.list')] }, installmentsController.getCallList as any);

  // Get overdue installments (admin, accountant — shop-scoped)
  app.get('/overdue', { preHandler: [authenticate, shopScope, requirePermission('installments.tab.all_overdue')] }, installmentsController.getOverdue as any);

  // Get collections for date range (admin, accountant, employee — shop-scoped)
  app.get('/collections/range', { preHandler: [authenticate, shopScope, requirePermission('installments.tab.todays_scheduled')] }, installmentsController.getCollectionsForDateRange as any);

  // Get paid installments for a date range (admin, accountant — shop-scoped)
  app.get('/collections/paid-range', { preHandler: [authenticate, shopScope, requirePermission('installments.list')] }, installmentsController.getPaidCollectionsForDateRange as any);

  // Get today's collections (admin, accountant, employee — shop-scoped)
  app.get('/collections/today', { preHandler: [authenticate, shopScope, requirePermission('installments.tab.todays_scheduled')] }, installmentsController.getCollectionsToday as any);

  // Get collections for a specific date (admin, accountant, employee — shop-scoped)
  app.get('/collections/date/:date', { preHandler: [authenticate, shopScope, requirePermission('installments.tab.todays_scheduled')] }, installmentsController.getCollectionsForDate as any);

  // Search installment schedules (admin, accountant, employee — shop-scoped)
  app.get('/search', { preHandler: [authenticate, shopScope, requirePermission('installments.tab.search')] }, installmentsController.searchSchedules as any);

  // Get schedule detail (admin, accountant, employee)
  app.get('/:scheduleId', { preHandler: [authenticate, requirePermission('installments.detail')] }, installmentsController.getScheduleDetail as any);

  // Get timeline (admin, accountant)
  app.get('/:scheduleId/timeline', { preHandler: [authenticate, requirePermission('installments.payment_timeline')] }, installmentsController.getTimeline as any);

  // What the collector may charge (late penalty) or give (early-payment
  // deduction) before recording a payment. Read-only.
  app.get(
    '/:installmentId/payment-preview',
    { preHandler: [authenticate, shopScope, requirePermission('installments.record_payment')] },
    installmentsController.getPaymentPreview as any,
  );

  // Change the ₹/day late-penalty rate on an existing sale.
  app.patch(
    '/schedules/:scheduleId/penalty-per-day',
    { preHandler: [authenticate, shopScope, requirePermission('installments.interest.apply'), validate(penaltyPerDaySchema)] },
    installmentsController.updatePenaltyPerDay as any,
  );

  // Record payment (admin, accountant, employee — the main action)
  app.post('/:installmentId/pay', {
    preHandler: [authenticate, shopScope, requirePermission('installments.record_payment'), validate(recordPaymentSchema)],
  }, installmentsController.recordPayment as any);

  // Roll log (audit trail for a schedule — admin, accountant, employee)
  app.get('/:scheduleId/roll-log', { preHandler: [authenticate, requirePermission('installments.payment_timeline')] }, installmentsController.getRollLog as any);

  // Revert a payment (admin only)
  app.post('/payments/:paymentId/revert', {
    preHandler: [authenticate, shopScope, requirePermission('installments.revert_payment')],
  }, installmentsController.revertPayment as any);

  // Move a mis-recorded payment to the correct installment (admin, accountant)
  app.post('/payments/:paymentId/move', {
    preHandler: [authenticate, shopScope, requirePermission('installments.revert_payment'), validate(movePaymentSchema)],
  }, installmentsController.movePayment as any);

  // Correct a payment recorded with the wrong (higher) amount (admin, accountant)
  app.post('/payments/:paymentId/correct', {
    preHandler: [authenticate, shopScope, requirePermission('installments.revert_payment'), validate(correctPaymentSchema)],
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
