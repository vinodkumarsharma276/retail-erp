import type { FastifyRequest, FastifyReply } from 'fastify';
import { formsService } from './forms.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const formsController = {
  async listDefinitions(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const definitions = await formsService.listDefinitions();
      return sendSuccess(reply, definitions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch form definitions';
      return sendError(reply, message, 500);
    }
  },

  async getDefinitionByName(
    request: FastifyRequest<{ Params: { formName: string }; Querystring: { shopId?: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { formName } = request.params;
      const shopId = request.query.shopId || request.currentUser?.shopId;

      const definition = await formsService.getDefinitionByName(formName, shopId);
      if (!definition) {
        return sendError(reply, 'Form definition not found', 404);
      }
      return sendSuccess(reply, definition);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch form definition';
      return sendError(reply, message, 500);
    }
  },

  async getDefinitionById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const definition = await formsService.getDefinitionById(request.params.id);
      if (!definition) {
        return sendError(reply, 'Form definition not found', 404);
      }
      return sendSuccess(reply, definition);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch form definition';
      return sendError(reply, message, 500);
    }
  },

  async createDefinition(
    request: FastifyRequest<{
      Body: {
        formName: string;
        shopId?: string | null;
        description?: string | null;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const definition = await formsService.createDefinition(request.body);
      return sendSuccess(reply, definition, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create form definition';
      return sendError(reply, message, 500);
    }
  },

  async updateDefinition(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        formName?: string;
        description?: string | null;
        isActive?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await formsService.updateDefinition(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Form definition not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update form definition';
      return sendError(reply, message, 500);
    }
  },

  async getFields(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const fields = await formsService.getFields(request.params.id);
      if (fields === null) {
        return sendError(reply, 'Form definition not found', 404);
      }
      return sendSuccess(reply, fields);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch form fields';
      return sendError(reply, message, 500);
    }
  },

  async addField(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        fieldName: string;
        fieldLabel: string;
        fieldType: string;
        placeholder?: string | null;
        defaultValue?: string | null;
        isRequired?: boolean;
        validationRules?: unknown;
        options?: unknown;
        sectionName?: string | null;
        isVisible?: boolean;
        cssClass?: string | null;
        dependsOn?: unknown;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const field = await formsService.addField(request.params.id, request.body);
      return sendSuccess(reply, field, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add form field';
      if (message === 'Form definition not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async updateField(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        fieldName?: string;
        fieldLabel?: string;
        fieldType?: string;
        placeholder?: string | null;
        defaultValue?: string | null;
        isRequired?: boolean;
        validationRules?: unknown;
        options?: unknown;
        sectionName?: string | null;
        isVisible?: boolean;
        cssClass?: string | null;
        dependsOn?: unknown;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await formsService.updateField(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Form field not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update form field';
      return sendError(reply, message, 500);
    }
  },

  async deleteField(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const deleted = await formsService.deleteField(request.params.id);
      if (!deleted) {
        return sendError(reply, 'Form field not found', 404);
      }
      return sendSuccess(reply, { message: 'Field deleted successfully', field: deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete form field';
      return sendError(reply, message, 500);
    }
  },

  async reorderFields(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { fieldIds: string[] };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const fields = await formsService.reorderFields(request.params.id, request.body.fieldIds);
      return sendSuccess(reply, fields);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reorder fields';
      if (message === 'Form definition not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 400);
    }
  },
};
