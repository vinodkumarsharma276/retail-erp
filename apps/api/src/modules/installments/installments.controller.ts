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
      const shopId = request.shopFilter!.shopId;

      const { schedules, totalItems } = await installmentsService.listSchedules(shopId, {
        page,
        pageSize,
        skip,
        take,
        status,
      });

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
      const shopId = request.shopFilter!.shopId;
      const overdue = await installmentsService.getOverdue(shopId);
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
      const shopId = request.shopFilter!.shopId;
      const { employeeId } = request.query;

      // For employees, auto-filter to their own assignments
      const effectiveEmployeeId =
        request.currentUser!.role === 'employee'
          ? request.currentUser!.userId
          : employeeId;

      const today = new Date().toISOString().split('T')[0];
      const result = await installmentsService.getCollectionsForDate(
        shopId,
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
      const shopId = request.shopFilter!.shopId;
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
        shopId,
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
      const shopId = request.shopFilter!.shopId;
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
        shopId, dateFrom, dateTo, effectiveEmployeeId,
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
      const shopId = request.shopFilter!.shopId;
      const today = new Date().toISOString().split('T')[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const dateFrom = request.query.dateFrom || twoWeeksAgo;
      const dateTo = request.query.dateTo || today;

      const result = await installmentsService.getPaidCollectionsForDateRange(
        shopId,
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
      const shopId = request.shopFilter!.shopId;
      const query = request.query.q || '';
      const filterBy = request.query.filterBy || 'all';

      const results = await installmentsService.searchSchedules(shopId, query, filterBy);
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
        newDate?: string;
        referenceNumber?: string;
        notes?: string;
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
};
