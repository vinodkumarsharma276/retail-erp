import type { FastifyRequest, FastifyReply } from 'fastify';
import { installmentsService } from './installments.service.js';
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
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { shopId, shopIds, allShops } = request.shopFilter!;
      const overdue = await installmentsService.getOverdue({
        shopId,
        shopIds: allShops ? shopIds : undefined,
      });
      return sendSuccess(reply, overdue);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch overdue installments';
      return sendError(reply, message, 500);
    }
  },

  async getCollectionsToday(
    request: FastifyRequest<{
      Querystring: { employeeId?: string };
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
      Querystring: { employeeId?: string };
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
      );

      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch collections';
      return sendError(reply, message, 500);
    }
  },

  async getCollectionsForDateRange(
    request: FastifyRequest<{
      Querystring: { dateFrom?: string; dateTo?: string; employeeId?: string };
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
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch collections';
      return sendError(reply, message, 500);
    }
  },

  async getPaidCollectionsForDateRange(
    request: FastifyRequest<{
      Querystring: { dateFrom?: string; dateTo?: string };
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
        scenario: 'full_payment' | 'reschedule' | 'partial_reschedule';
        amountPaid?: number;
        paymentMode?: string;
        paymentBreakdown?: Array<{ mode: string; amount: number }>;
        newDate?: string;
        referenceNumber?: string;
        notes?: string;
        applyInterest?: { amount: number; notes?: string };
        waiveExcessInterest?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = request.currentUser!.userId;
      const result = await installmentsService.recordPayment(
        request.params.installmentId,
        request.body,
        userId,
      );
      return sendSuccess(reply, result, 201);
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
        message.startsWith('Partial amount')
      ) {
        return sendError(reply, message, 400);
      }
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
      const result = await installmentsService.revertPayment(
        request.params.paymentId,
        request.body.reason,
        request.currentUser?.userId ?? '',
        { applyInterest: request.body.applyInterest, cascade: request.body.cascade },
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revert payment';
      if (message === 'Payment not found') {
        return sendError(reply, message, 404);
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
      const result = await installmentsService.applyOverdueInterest(
        request.params.installmentId,
        request.body,
        request.currentUser?.userId ?? '',
      );
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
      const result = await installmentsService.rollbackInterestApplication(
        request.params.applicationId,
        request.body,
        request.currentUser?.userId ?? '',
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
