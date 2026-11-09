import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerSearchService, CustomerSearchError, type SearchFilters } from './customer-search.service.js';
import { commitImport, previewImport, ImportError } from './customer-search.import.js';
import type { EntryInput, EntryUpdateInput, ImportCommitInput, ImportPreviewInput } from './customer-search.validation.js';
import { sendError, sendPaginated, sendSuccess } from '../../utils/response.js';
import { parsePagination } from '../../utils/pagination.js';
import { loadUsablePermissions } from '../../middleware/permissions.js';

type ListQuery = SearchFilters & { page?: string; pageSize?: string };

function fail(reply: FastifyReply, error: unknown, fallback: string) {
  if (error instanceof CustomerSearchError) {
    return reply.status(error.statusCode).send({ success: false, error: error.message, ...(error.details ? { details: error.details } : {}) });
  }
  if (error instanceof ImportError) return sendError(reply, error.message, error.statusCode);
  return sendError(reply, error instanceof Error ? error.message : fallback, 500);
}

const ctxOf = (request: FastifyRequest) => ({
  shopId: request.shopFilter!.shopId,
  userId: request.currentUser!.userId,
});

export const customerSearchController = {
  async list(request: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) {
    try {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const { entries, totalItems } = await customerSearchService.list(request.query, { skip, take });
      return sendPaginated(reply, entries, { page, pageSize, totalItems });
    } catch (error) {
      return fail(reply, error, 'Failed to search the register');
    }
  },

  async getById(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const perms = await loadUsablePermissions(request.currentUser!.userId, request.tenant?.id ?? request.currentUser!.tenantId);
      const entry = await customerSearchService.getById(request.params.id, {
        canSeeSales: perms.has('sales.detail') && perms.has('sales.view_real'),
      });
      if (!entry) return sendError(reply, 'Entry not found', 404);
      return sendSuccess(reply, entry);
    } catch (error) {
      return fail(reply, error, 'Failed to load the entry');
    }
  },

  async forCustomer(request: FastifyRequest<{ Params: { customerId: string } }>, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.forCustomer(request.params.customerId));
    } catch (error) {
      return fail(reply, error, "Failed to load the customer's items");
    }
  },

  async prefixes(_request: FastifyRequest, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.prefixes());
    } catch (error) {
      return fail(reply, error, 'Failed to load prefixes');
    }
  },

  async reviewSummary(_request: FastifyRequest, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.reviewSummary());
    } catch (error) {
      return fail(reply, error, 'Failed to count entries needing review');
    }
  },

  async nextNumber(request: FastifyRequest<{ Querystring: { prefix?: string } }>, reply: FastifyReply) {
    try {
      const prefix = (request.query.prefix ?? '').trim();
      if (!/^[A-Za-z]{1,3}\d?$/.test(prefix)) return sendError(reply, 'Prefix must be 1-3 letters, optionally followed by one digit (CI2)');
      return sendSuccess(reply, await customerSearchService.nextNumber(prefix));
    } catch (error) {
      return fail(reply, error, 'Failed to suggest a number');
    }
  },

  async customerMatches(request: FastifyRequest<{ Querystring: { mobile?: string; name?: string } }>, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.customerMatches(request.query.mobile ?? '', request.query.name));
    } catch (error) {
      return fail(reply, error, 'Failed to look up customers');
    }
  },

  async create(request: FastifyRequest<{ Body: EntryInput }>, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.create(request.body, ctxOf(request)), 201);
    } catch (error) {
      return fail(reply, error, 'Failed to save the entry');
    }
  },

  async update(request: FastifyRequest<{ Params: { id: string }; Body: EntryUpdateInput }>, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.update(request.params.id, request.body, ctxOf(request)));
    } catch (error) {
      return fail(reply, error, 'Failed to update the entry');
    }
  },

  async remove(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.remove(request.params.id));
    } catch (error) {
      return fail(reply, error, 'Failed to delete the entry');
    }
  },

  async importPreview(request: FastifyRequest<{ Body: ImportPreviewInput }>, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await previewImport(request.body));
    } catch (error) {
      return fail(reply, error, 'Failed to check the rows');
    }
  },

  async importCommit(request: FastifyRequest<{ Body: ImportCommitInput }>, reply: FastifyReply) {
    try {
      const perms = await loadUsablePermissions(request.currentUser!.userId, request.tenant?.id ?? request.currentUser!.tenantId);
      const result = await commitImport(request.body, request.currentUser!.userId, { canCreateTypes: perms.has('categories.create') });
      return sendSuccess(reply, result, 201);
    } catch (error) {
      return fail(reply, error, 'Failed to import the rows');
    }
  },

  async importBatches(_request: FastifyRequest, reply: FastifyReply) {
    try {
      return sendSuccess(reply, await customerSearchService.listImportBatches());
    } catch (error) {
      return fail(reply, error, 'Failed to load past imports');
    }
  },

  async export(request: FastifyRequest<{ Querystring: SearchFilters }>, reply: FastifyReply) {
    try {
      const file = await customerSearchService.export(request.query);
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
        .send(file.body);
    } catch (error) {
      return fail(reply, error, 'Failed to export');
    }
  },
};
