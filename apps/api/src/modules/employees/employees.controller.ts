import type { FastifyRequest, FastifyReply } from 'fastify';
import { employeesService } from './employees.service.js';
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';

export const employeesController = {
  async list(
    request: FastifyRequest<{
      Querystring: {
        page?: string;
        pageSize?: string;
        search?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { search } = request.query;
      const shopId = request.shopFilter!.shopId;

      const { employees, totalItems } = await employeesService.list(shopId, {
        page,
        pageSize,
        skip,
        take,
        search,
      });

      return sendPaginated(reply, employees, { page, pageSize, totalItems });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch employees';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const employee = await employeesService.getById(request.params.id);
      if (!employee) {
        return sendError(reply, 'Employee not found', 404);
      }
      return sendSuccess(reply, employee);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch employee';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        userId: string;
        designation?: string | null;
        dateOfJoining?: string | null;
        salary?: number | null;
        aadhaarNumber?: string | null;
        address?: string | null;
        emergencyContact?: string | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const shopId = request.shopFilter!.shopId;
      const employee = await employeesService.create(shopId, request.body);
      return sendSuccess(reply, employee, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create employee';
      if (message === 'User not found') {
        return sendError(reply, message, 404);
      }
      if (message === 'User is already linked to an employee record') {
        return sendError(reply, message, 409);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        designation?: string | null;
        dateOfJoining?: string | null;
        salary?: number | null;
        aadhaarNumber?: string | null;
        address?: string | null;
        emergencyContact?: string | null;
        isActive?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await employeesService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Employee not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update employee';
      return sendError(reply, message, 500);
    }
  },
};
