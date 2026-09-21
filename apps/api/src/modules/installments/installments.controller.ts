import type { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentMode } from '@prisma/client';
import { prisma } from '../../config/database.js';
import {
  applyInterest,
  buildPaymentPreview,
  recordPayment as recordPatternBPayment,
  revertPayment as revertPatternBPayment,
  rollbackInterest,
} from './installments.engine.js';
import { installmentsService } from './installments.service.js';
import { promisesService } from '../promises/promises.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const installmentsController = {
  async listSchedules(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        status?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { status } = request.query;
      const { shopId, shopIds, allShops } = request.shopFilter!;

      const { schedules, totalItems } = await installmentsService.listSchedules(
        { shopId, shopIds: allShops ? shopIds : undefined },
        {
          page,
          pageSize,
          skip,
          take,
          status,
        },
      );

      return sendPaginated(reply, schedules, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch installment schedules';
      return sendError(reply, message, 500);
    }
  },

  async getOverdue(
    request: FastifyRequest<{ Querystring: { zone?: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const overdue = await installmentsService.getOverdue(
        { shopId, shopIds: allShops ? shopIds : undefined },
        { zone: request.query.zone || undefined },
      );
      return sendSuccess(reply, overdue);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch overdue installments';
      return sendError(reply, message, 500);
    }
  },

  async getCollectionsToday(
    request: FastifyRequest<{
      Querystring: { employeeId?: string; zone?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const { employeeId } = request.query;

      // For employees, auto-filter to their own assignments
      const effectiveEmployeeId =
        request.currentUser!.role === 'employee'
          ? request.currentUser!.userId
          : employeeId;

      const today = new Date().toISOString().split('T')[0];
      const result = await installmentsService.getCollectionsForDate(
        { shopId, shopIds: allShops ? shopIds : undefined },
        today,
        effectiveEmployeeId,
        { zone: request.query.zone || undefined },
      );

      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch today\'s collections';
      return sendError(reply, message, 500);
    }
  },

  async getCollectionsForDate(
    request: FastifyRequest<{
      Params: { date: string };
      Querystring: { employeeId?: string; zone?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const { date } = request.params;
      const { employeeId } = request.query;

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return sendError(reply, 'Date must be in YYYY-MM-DD format', 400);
      }

      // For employees, auto-filter to their own assignments
      const effectiveEmployeeId =
        request.currentUser!.role === 'employee'
          ? request.currentUser!.userId
          : employeeId;

      const result = await installmentsService.getCollectionsForDate(
        { shopId, shopIds: allShops ? shopIds : undefined },
        date,
        effectiveEmployeeId,
        { zone: request.query.zone || undefined },
      );

      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch collections';
      return sendError(reply, message, 500);
    }
  },

  async getCollectionsForDateRange(
    request: FastifyRequest<{
      Querystring: { dateFrom?: string; dateTo?: string; employeeId?: string; zone?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const today = new Date().toISOString().split('T')[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const dateFrom = request.query.dateFrom || twoWeeksAgo;
      const dateTo = request.query.dateTo || today;
      const employeeId = request.query.employeeId;

      // For employees, auto-filter to their own assignments
      const effectiveEmployeeId =
        request.currentUser!.role === 'employee'
          ? request.currentUser!.userId
          : employeeId;

      const result = await installmentsService.getCollectionsForDateRange(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
        effectiveEmployeeId,
        { zone: request.query.zone || undefined },
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch collections';
      return sendError(reply, message, 500);
    }
  },

  async getPaidCollectionsForDateRange(
    request: FastifyRequest<{
      Querystring: { dateFrom?: string; dateTo?: string; zone?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const today = new Date().toISOString().split('T')[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const dateFrom = request.query.dateFrom || twoWeeksAgo;
      const dateTo = request.query.dateTo || today;

      const result = await installmentsService.getPaidCollectionsForDateRange(
        { shopId, shopIds: allShops ? shopIds : undefined },
        dateFrom,
        dateTo,
        { zone: request.query.zone || undefined },
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch paid collections';
      return sendError(reply, message, 500);
    }
  },

  async searchSchedules(
    request: FastifyRequest<{
      Querystring: { q?: string; filterBy?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const query = request.query.q || '';
      const filterBy = request.query.filterBy || 'all';

      const results = await installmentsService.searchSchedules(
        { shopId, shopIds: allShops ? shopIds : undefined },
        query,
        filterBy,
      );
      return sendSuccess(reply, results);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search failed';
      return sendError(reply, message, 500);
    }
  },

  async getScheduleDetail(
    request: FastifyRequest<{ Params: { scheduleId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const schedule = await installmentsService.getScheduleDetail(request.params.scheduleId);
      if (!schedule) {
        return sendError(reply, 'Installment schedule not found', 404);
      }
      return sendSuccess(reply, schedule);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch schedule detail';
      return sendError(reply, message, 500);
    }
  },

  async getTimeline(
    request: FastifyRequest<{ Params: { scheduleId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const timeline = await installmentsService.getTimeline(request.params.scheduleId);
      if (!timeline) {
        return sendError(reply, 'Installment schedule not found', 404);
      }
      return sendSuccess(reply, timeline);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch timeline';
      return sendError(reply, message, 500);
    }
  },

  async recordPayment(
    request: FastifyRequest<{
      Params: { installmentId: string };
      Body: {
        scenario?: 'full_payment' | 'reschedule' | 'partial_reschedule';
        amount?: number;
        amountPaid?: number;
        paymentMode?: string;
        explicitInstallmentId?: string;
        paymentDate?: string;
        newDate?: string;
        referenceNumber?: string;
        notes?: string;
        applyInterest?: { installmentId?: string; amount?: number; appliedAmount?: number; daysOverdue?: number; notes?: string };
        /** Collector ticked "apply late penalty" — server computes the amount. */
        applyPenalty?: boolean;
        /** Collector ticked "deduct early-payment interest from last installment". */
        applyEarlyPaymentDeduction?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const amount = request.body.amount ?? request.body.amountPaid;
      if (!amount) return sendError(reply, 'amount is required', 400);
      if (!request.body.paymentMode) return sendError(reply, 'paymentMode is required', 400);

      const interestAmount = request.body.applyInterest?.appliedAmount ?? request.body.applyInterest?.amount;
      const result = await recordPatternBPayment(prisma, {
        installmentId: request.params.installmentId,
        amount,
        paymentMode: request.body.paymentMode as PaymentMode,
        paymentDate: request.body.paymentDate ? new Date(request.body.paymentDate) : undefined,
        explicitInstallmentId: request.body.explicitInstallmentId,
        referenceNumber: request.body.referenceNumber,
        notes: request.body.notes,
        applyInterest: interestAmount
          ? {
              installmentId: request.body.applyInterest?.installmentId ?? request.params.installmentId,
              appliedAmount: interestAmount,
              daysOverdue: request.body.applyInterest?.daysOverdue,
              notes: request.body.applyInterest?.notes,
            }
          : undefined,
        applyPenalty: request.body.applyPenalty === true,
        applyEarlyPaymentDeduction: request.body.applyEarlyPaymentDeduction === true,
      }, { tenantId: request.tenant!.id, actorUserId: userId });

      let promise = null;
      if (request.body.scenario === 'partial_reschedule' && request.body.newDate) {
        const target = await prisma.installment.findFirst({
          where: { id: request.body.explicitInstallmentId ?? request.params.installmentId, tenantId: request.tenant!.id },
          select: {
            id: true,
            scheduleId: true,
            remainingAmount: true,
            schedule: { select: { sale: { select: { customerId: true } } } },
          },
        });
        if (target && Number(target.remainingAmount) > 0) {
          promise = await promisesService.create({
            scheduleId: target.scheduleId,
            customerId: target.schedule.sale.customerId,
            coveredInstallmentIds: [target.id],
            promisedDate: request.body.newDate,
            promisedAmount: Number(target.remainingAmount),
            notes: request.body.notes,
          }, { tenantId: request.tenant!.id, actorUserId: userId });
        }
      }
      return sendSuccess(reply, { ...result, promise }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record payment';
      if (
        message === 'Installment not found'
      ) {
        return sendError(reply, message, 404);
      }
      if (
        message === 'Installment is already fully paid' ||
        message === 'Installment has been rescheduled. Pay the rescheduled installment instead.' ||
        message.startsWith('Amount') ||
        message.startsWith('Partial amount') ||
        message.startsWith('Early-payment deduction') ||
        message.startsWith('The early-payment deduction') ||
        message === 'Schedule is already fully paid' ||
        message === 'Installment does not belong to this schedule'
      ) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  /**
   * GET /installments/:installmentId/payment-preview?paymentDate=YYYY-MM-DD
   * The penalty the collector may charge and the early-payment deduction they
   * may give, for one EMI on a given date. Read-only.
   */
  async getPaymentPreview(
    request: FastifyRequest<{
      Params: { installmentId: string };
      Querystring: { paymentDate?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const raw = request.query.paymentDate;
      if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return sendError(reply, 'paymentDate must be YYYY-MM-DD', 400);
      }
      const preview = await buildPaymentPreview(
        prisma,
        request.params.installmentId,
        { paymentDate: raw ? new Date(raw) : undefined },
        { tenantId: request.tenant!.id },
      );
      return sendSuccess(reply, preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build payment preview';
      return sendError(reply, message, message === 'Installment not found' ? 404 : 500);
    }
  },

  /**
   * PATCH /installments/schedules/:scheduleId/penalty-per-day
   * Change the late-penalty rate (₹/day) on an existing sale. Affects only
   * penalty charged from now on; charges already made are untouched.
   */
  async updatePenaltyPerDay(
    request: FastifyRequest<{
      Params: { scheduleId: string };
      Body: { penaltyPerDay: number };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const schedule = await prisma.installmentSchedule.findFirst({
        where: { id: request.params.scheduleId, tenantId: request.tenant!.id },
        select: { saleId: true },
      });
      if (!schedule) return sendError(reply, 'Installment schedule not found', 404);

      const sale = await prisma.saleRecord.update({
        where: { id: schedule.saleId },
        data: { penaltyPerDay: request.body.penaltyPerDay },
        select: { id: true, penaltyPerDay: true },
      });
      return sendSuccess(reply, { saleId: sale.id, penaltyPerDay: Number(sale.penaltyPerDay) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update penalty rate';
      return sendError(reply, message, 500);
    }
  },

  async reschedule(
    request: FastifyRequest<{
      Params: { installmentId: string };
      Body: {
        newDate: string;
        notes?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await installmentsService.reschedule(
        request.params.installmentId,
        request.body,
        request.currentUser?.userId ?? null,
      );
      return sendSuccess(reply, result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reschedule installment';
      if (message === 'Installment not found') {
        return sendError(reply, message, 404);
      }
      if (
        message === 'Cannot reschedule a paid installment' ||
        message === 'Installment has already been rescheduled'
      ) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  /**
   * Preview whether a reschedule on the given installment can be safely
   * undone, and what the consequence will be. Used by the UI to decide if
   * the Undo button should be shown / enabled and what dialog text to
   * display.
   */
  async previewUndoReschedule(
    request: FastifyRequest<{ Params: { installmentId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await installmentsService.previewUndoReschedule(
        request.params.installmentId,
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview undo';
      return sendError(reply, message, 500);
    }
  },

  /**
   * Undo a reschedule. The installmentId is either:
   *   • the reschedule-created sub-row (#N.k), or
   *   • the source primary row whose remainder was redistributed.
   * See `installmentsService.undoReschedule` for the full algorithm.
   */
  async undoReschedule(
    request: FastifyRequest<{
      Params: { installmentId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await installmentsService.undoReschedule(
        request.params.installmentId,
        request.body.reason,
        request.currentUser?.userId ?? null,
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to undo reschedule';
      if (message === 'Installment not found') {
        return sendError(reply, message, 404);
      }
      if (
        message.startsWith('Cannot undo:') ||
        message === 'No reschedule found to undo.' ||
        message === 'Source installment not found' ||
        message === 'Source installment not found.' ||
        message === 'Source primary installment not found' ||
        message === 'Latest redistribute event does not target this installment.' ||
        message === 'Redistribution log has no targets.'
      ) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async getRollLog(
    request: FastifyRequest<{ Params: { scheduleId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const log = await installmentsService.getRollLog(request.params.scheduleId);
      return sendSuccess(reply, log);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch roll log';
      return sendError(reply, message, 500);
    }
  },

  async runRollover(
    request: FastifyRequest<{ Querystring: { date?: string; scheduleId?: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const dateStr = request.query.date ?? new Date().toISOString().split('T')[0];
      const result = await installmentsService.runRollover({
        date: dateStr,
        scheduleId: request.query.scheduleId,
      });
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run rollover';
      return sendError(reply, message, 500);
    }
  },

  async revertPayment(
    request: FastifyRequest<{
      Params: { paymentId: string };
      Body: {
        reason: string;
        applyInterest?: { amount: number; notes?: string };
        cascade?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const patternBResult = await revertPatternBPayment(
        prisma,
        request.params.paymentId,
        request.body.reason,
        { tenantId: request.tenant!.id, actorUserId: request.currentUser?.userId ?? '' },
      );
      return sendSuccess(reply, patternBResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revert payment';
      if (message === 'Payment not found') {
        return sendError(reply, message, 404);
      }
      if (message.startsWith('Cannot revert:')) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async getSettlementQuote(
    request: FastifyRequest<{ Params: { scheduleId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const quote = await installmentsService.getSettlementQuote(request.params.scheduleId);
      if (!quote) return sendError(reply, 'Schedule not found', 404);
      return sendSuccess(reply, quote);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to compute quote';
      return sendError(reply, message, 500);
    }
  },

  async recordFinalSettlement(
    request: FastifyRequest<{
      Params: { scheduleId: string };
      Body: {
        paymentMode: string;
        paymentDate?: string;
        referenceNumber?: string;
        notes?: string;
        expectedAmount?: number;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await installmentsService.recordFinalSettlement(
        request.params.scheduleId,
        request.body,
        request.currentUser?.userId ?? '',
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record settlement';
      return sendError(reply, message, 400);
    }
  },

  async getInterestAccrual(
    request: FastifyRequest<{ Params: { scheduleId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const data = await installmentsService.getInterestAccrual(request.params.scheduleId);
      if (data === null) return sendError(reply, 'Schedule not found', 404);
      return sendSuccess(reply, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to compute interest accrual';
      return sendError(reply, message, 500);
    }
  },

  async applyOverdueInterest(
    request: FastifyRequest<{
      Params: { installmentId: string };
      Body: { amount: number; notes?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await applyInterest(prisma, request.params.installmentId, request.body, {
        tenantId: request.tenant!.id,
        actorUserId: request.currentUser?.userId ?? '',
      });
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply interest';
      return sendError(reply, message, 400);
    }
  },

  async rollbackInterestApplication(
    request: FastifyRequest<{
      Params: { applicationId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await rollbackInterest(
        prisma,
        request.params.applicationId,
        request.body.reason,
        { tenantId: request.tenant!.id, actorUserId: request.currentUser?.userId ?? '' },
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rollback interest';
      return sendError(reply, message, 400);
    }
  },

  async movePayment(
    request: FastifyRequest<{
      Params: { paymentId: string };
      Body: {
        targetInstallmentId: string;
        reason: string;
        paymentDate?: string;
        applyInterestOnTarget?: { amount: number; notes?: string };
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await installmentsService.movePayment(
        request.params.paymentId,
        request.body.targetInstallmentId,
        request.body.reason,
        request.currentUser?.userId ?? '',
        {
          paymentDate: request.body.paymentDate,
          applyInterestOnTarget: request.body.applyInterestOnTarget,
        },
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move payment';
      if (message === 'Payment not found' || message === 'Target installment not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 400);
    }
  },

  async correctPayment(
    request: FastifyRequest<{
      Params: { paymentId: string };
      Body: {
        correctAmount: number;
        reason: string;
        applyInterest?: { amount: number; notes?: string };
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await installmentsService.correctPayment(
        request.params.paymentId,
        request.body.correctAmount,
        request.body.reason,
        request.currentUser?.userId ?? '',
        { applyInterest: request.body.applyInterest },
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to correct payment';
      if (message === 'Payment not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 400);
    }
  },
};
