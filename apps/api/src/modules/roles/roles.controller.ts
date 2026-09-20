import type { FastifyRequest, FastifyReply } from 'fastify';
import { rolesService } from './roles.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const rolesController = {
  async listGroups(_request: FastifyRequest, reply: FastifyReply) {
    return sendSuccess(reply, await rolesService.listGroups());
  },

  async listRoles(_request: FastifyRequest, reply: FastifyReply) {
    return sendSuccess(reply, await rolesService.listRoles());
  },

  async getRole(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const role = await rolesService.getRole(request.params.id);
    if (!role) return sendError(reply, 'Role not found', 404);
    return sendSuccess(reply, role);
  },

  async createRole(
    request: FastifyRequest<{ Body: { code: string; name: string; description?: string } }>,
    reply: FastifyReply,
  ) {
    return sendSuccess(reply, await rolesService.createRole(request.body), 201);
  },

  async updateRole(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { name?: string; description?: string; isActive?: boolean };
    }>,
    reply: FastifyReply,
  ) {
    return sendSuccess(reply, await rolesService.updateRole(request.params.id, request.body));
  },

  async deleteRole(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await rolesService.deleteRole(request.params.id);
      return sendSuccess(reply, { ok: true });
    } catch (e) {
      return sendError(reply, (e as Error).message, 400);
    }
  },

  async setPermissions(
    request: FastifyRequest<{ Params: { id: string }; Body: { permissions: string[] } }>,
    reply: FastifyReply,
  ) {
    const keys = await rolesService.setRolePermissions(
      request.params.id,
      request.body.permissions,
    );
    return sendSuccess(reply, { permissions: keys });
  },

  async cloneRole(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { code: string; name: string };
    }>,
    reply: FastifyReply,
  ) {
    const role = await rolesService.cloneRole(
      request.params.id,
      request.body.code,
      request.body.name,
    );
    return sendSuccess(reply, role, 201);
  },

  async listUsers(_request: FastifyRequest, reply: FastifyReply) {
    return sendSuccess(reply, await rolesService.listUsers());
  },

  async assignUserRole(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { roleId: string | null };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const u = await rolesService.assignUserRole(request.params.userId, request.body.roleId);
      return sendSuccess(reply, { id: u.id, roleId: u.roleId, role: u.role });
    } catch (e) {
      return sendError(reply, (e as Error).message, 400);
    }
  },

  async resetPassword(
    request: FastifyRequest<{
      Params: { userId: string };
      Body?: { password?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await rolesService.resetPassword(
        request.params.userId,
        request.body?.password,
      );
      return sendSuccess(reply, result);
    } catch (e) {
      return sendError(reply, (e as Error).message, 400);
    }
  },

  async getUserPermissions(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await rolesService.getUserPermissions(request.params.userId);
      return sendSuccess(reply, result);
    } catch (e) {
      const message = (e as Error).message;
      if (message === 'User not found') return sendError(reply, message, 404);
      return sendError(reply, message, 500);
    }
  },

  async setUserPermissions(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { grants?: string[]; denies?: string[] };
    }>,
    reply: FastifyReply,
  ) {
    try {
      if (!request.currentUser) {
        return sendError(reply, 'Authentication required', 401);
      }
      const result = await rolesService.setUserPermissionOverrides(
        request.params.userId,
        request.body.grants ?? [],
        request.body.denies ?? [],
        request.currentUser.userId,
      );
      return sendSuccess(reply, result);
    } catch (e) {
      return sendError(reply, (e as Error).message, 400);
    }
  },
};
