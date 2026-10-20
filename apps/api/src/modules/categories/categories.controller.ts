import type { FastifyRequest, FastifyReply } from 'fastify';
import { categoriesService, DuplicateCategoryError } from './categories.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const categoriesController = {
  async getTree(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const tree = await categoriesService.getTree();
      return sendSuccess(reply, tree);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch category tree';
      return sendError(reply, message, 500);
    }
  },

  async getById(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const category = await categoriesService.getById(request.params.id);
      if (!category) {
        return sendError(reply, 'Category not found', 404);
      }
      return sendSuccess(reply, category);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch category';
      return sendError(reply, message, 500);
    }
  },

  async create(
    request: FastifyRequest<{
      Body: {
        name: string;
        slug: string;
        parentId?: string | null;
        isLeaf?: boolean;
        icon?: string | null;
        displayOrder?: number;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const category = await categoriesService.create(request.body);
      return sendSuccess(reply, category, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create category';
      if (error instanceof DuplicateCategoryError) {
        return sendError(reply, message, 409);
      }
      if (message === 'Parent category not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        slug?: string;
        parentId?: string | null;
        isLeaf?: boolean;
        icon?: string | null;
        displayOrder?: number;
        isActive?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await categoriesService.update(request.params.id, request.body);
      if (!updated) {
        return sendError(reply, 'Category not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update category';
      if (error instanceof DuplicateCategoryError) {
        return sendError(reply, message, 409);
      }
      if (message === 'Parent category not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async softDelete(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const deleted = await categoriesService.softDelete(request.params.id);
      if (!deleted) {
        return sendError(reply, 'Category not found', 404);
      }
      return sendSuccess(reply, { message: 'Category deactivated successfully', category: deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      if (message.startsWith('Cannot delete category')) {
        return sendError(reply, message, 409);
      }
      return sendError(reply, message, 500);
    }
  },

  async getAttributes(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const attributes = await categoriesService.getAttributes(request.params.id);
      if (attributes === null) {
        return sendError(reply, 'Category not found', 404);
      }
      return sendSuccess(reply, attributes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch attributes';
      return sendError(reply, message, 500);
    }
  },

  async addAttribute(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        attributeName: string;
        attributeLabel: string;
        attributeType: string;
        isRequired?: boolean;
        validationRules?: unknown;
        options?: unknown;
        displayOrder?: number;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const attribute = await categoriesService.addAttribute(request.params.id, request.body);
      return sendSuccess(reply, attribute, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add attribute';
      if (message === 'Category not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async updateAttribute(
    request: FastifyRequest<{
      Params: { id: string; attrId: string };
      Body: {
        attributeName?: string;
        attributeLabel?: string;
        attributeType?: string;
        isRequired?: boolean;
        validationRules?: unknown;
        options?: unknown;
        displayOrder?: number;
        isActive?: boolean;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const updated = await categoriesService.updateAttribute(request.params.attrId, request.body);
      if (!updated) {
        return sendError(reply, 'Attribute not found', 404);
      }
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update attribute';
      return sendError(reply, message, 500);
    }
  },

  async deleteAttribute(
    request: FastifyRequest<{ Params: { id: string; attrId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const deleted = await categoriesService.deleteAttribute(request.params.attrId);
      if (!deleted) {
        return sendError(reply, 'Attribute not found', 404);
      }
      return sendSuccess(reply, { message: 'Attribute deactivated successfully', attribute: deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete attribute';
      return sendError(reply, message, 500);
    }
  },
};
