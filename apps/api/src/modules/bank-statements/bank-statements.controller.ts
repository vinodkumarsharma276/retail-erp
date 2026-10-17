import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../../config/database.js';
import { sendError, sendSuccess } from '../../utils/response.js';
import { config } from './engine/config.js';
import { SUPPORTED_EXT } from './engine/parsers/index.js';
import * as service from './bank-statements.service.js';
import { HttpError, type Scope } from './bank-statements.service.js';
import {
  accountSchema,
  bulkPatchSchema,
  exportSchema,
  filterSchema,
  listSchema,
  ruleSchema,
  settingsSchema,
  statementPatchSchema,
  txPatchSchema,
  uploadFieldsSchema,
} from './bank-statements.validation.js';

export type Req = FastifyRequest<{ Params: { id: string }; Querystring: Record<string, unknown>; Body: unknown }>;

/** Tenant + every shop the request may touch (one shop, or all accessible shops in "All Shops" mode). */
export function scopeOf(request: FastifyRequest): Scope {
  const sf = request.shopFilter!;
  return { tenantId: sf.tenantId, shopIds: sf.allShops && sf.shopIds?.length ? sf.shopIds : [sf.shopId] };
}

async function reviewerName(request: FastifyRequest) {
  const user = await prisma.user.findUnique({ where: { id: request.currentUser!.userId }, select: { fullName: true } });
  return user?.fullName || request.currentUser!.username;
}

/** Map service / validation / multipart errors to the app's `{ success: false, error }` shape. */
export function handle(fn: (request: Req, reply: FastifyReply) => Promise<unknown>) {
  return async (request: Req, reply: FastifyReply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({ success: false, error: err.message, ...err.details });
      }
      if (err instanceof ZodError) {
        return reply.status(400).send({ success: false, error: 'Invalid request', details: err.issues });
      }
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return sendError(reply, `File is larger than ${Math.round(config.maxFileBytes / 1024 / 1024)} MB.`, 413);
      }
      request.log.error(err, 'bank-statements request failed');
      return sendError(reply, e?.message || 'Something went wrong', e?.statusCode && e.statusCode < 500 ? e.statusCode : 500);
    }
  };
}

export const bankStatementsController = {
  meta: handle(async (req, reply) => sendSuccess(reply, await service.getMeta(scopeOf(req)))),

  // ---------------------------------------------------------------- statements
  listStatements: handle(async (req, reply) => {
    const { shopIds } = filterSchema.pick({ shopIds: true }).parse(req.query);
    return sendSuccess(reply, await service.listStatements(scopeOf(req), shopIds));
  }),

  upload: handle(async (req, reply) => {
    const part = await req.file({ limits: { fileSize: config.maxFileBytes, files: 1 } });
    if (!part) throw new HttpError(400, 'No file received.');
    const ext = path.extname(part.filename).toLowerCase();
    if (!SUPPORTED_EXT.includes(ext)) {
      throw new HttpError(415, `Unsupported file type "${ext}". Use ${SUPPORTED_EXT.join(', ')}`);
    }
    // Text fields must be appended to the FormData before the file to appear here.
    const field = (name: string) => {
      const f = part.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' && f.value !== '' ? f.value : undefined;
    };
    const fields = uploadFieldsSchema.parse({
      shopId: field('shopId'),
      bank: field('bank'),
      password: field('password'),
      bankAccountId: field('bankAccountId'),
      duplicates: field('duplicates'),
    });
    const buffer = await part.toBuffer();
    const result = await service.uploadStatement(scopeOf(req), {
      buffer,
      fileName: part.filename,
      shopId: fields.shopId,
      bank: fields.bank,
      password: fields.password,
      bankAccountId: fields.bankAccountId,
      duplicates: fields.duplicates,
      uploadedById: req.currentUser!.userId,
    });
    return sendSuccess(reply, result, 201);
  }),

  updateStatement: handle(async (req, reply) =>
    sendSuccess(reply, await service.updateStatement(scopeOf(req), req.params.id, statementPatchSchema.parse(req.body))),
  ),

  deleteStatement: handle(async (req, reply) => {
    await service.deleteStatement(scopeOf(req), req.params.id);
    return sendSuccess(reply, { deleted: true });
  }),

  recategorize: handle(async (req, reply) => sendSuccess(reply, await service.recategorizeStatement(scopeOf(req), req.params.id))),

  // ---------------------------------------------------------------- transactions
  listTransactions: handle(async (req, reply) =>
    sendSuccess(reply, await service.listTransactions(scopeOf(req), listSchema.parse(req.query))),
  ),

  facets: handle(async (req, reply) => sendSuccess(reply, await service.getFacets(scopeOf(req)))),

  getTransaction: handle(async (req, reply) => sendSuccess(reply, await service.getTransaction(scopeOf(req), req.params.id))),

  updateTransaction: handle(async (req, reply) => {
    const scope = scopeOf(req);
    const updated = await service.patchTransactions(scope, [req.params.id], txPatchSchema.parse(req.body), await reviewerName(req));
    if (!updated.length) throw new HttpError(404, 'Transaction not found.');
    return sendSuccess(reply, await service.getTransaction(scope, req.params.id));
  }),

  bulkUpdate: handle(async (req, reply) => {
    const { ids, ...patch } = bulkPatchSchema.parse(req.body);
    const rows = await service.patchTransactions(scopeOf(req), ids, patch, await reviewerName(req));
    return sendSuccess(reply, { updated: rows.length });
  }),

  // ---------------------------------------------------------------- analytics & export
  analytics: handle(async (req, reply) => sendSuccess(reply, await service.getAnalytics(scopeOf(req), filterSchema.parse(req.query)))),

  exportTransactions: handle(async (req, reply) => {
    const { format, ...filters } = exportSchema.parse(req.query);
    const file = await service.exportTransactions(scopeOf(req), filters, format);
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  }),

  downloadFile: handle(async (req, reply) => {
    const file = await service.getStatementFile(scopeOf(req), req.params.id);
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .send(file.body);
  }),

  // ---------------------------------------------------------------- shop bank accounts
  listAccounts: handle(async (req, reply) => sendSuccess(reply, await service.listAccounts(scopeOf(req)))),

  createAccount: handle(async (req, reply) =>
    sendSuccess(reply, await service.createAccount(scopeOf(req), accountSchema.parse(req.body)), 201),
  ),

  deleteAccount: handle(async (req, reply) => {
    await service.deleteAccount(scopeOf(req), req.params.id);
    return sendSuccess(reply, { deleted: true });
  }),

  // ---------------------------------------------------------------- rules & settings
  listRules: handle(async (req, reply) => sendSuccess(reply, await service.listRules(scopeOf(req)))),

  createRule: handle(async (req, reply) => sendSuccess(reply, await service.createRule(scopeOf(req), ruleSchema.parse(req.body)), 201)),

  deleteRule: handle(async (req, reply) => {
    await service.deleteRule(scopeOf(req), req.params.id);
    return sendSuccess(reply, { deleted: true });
  }),

  getSettings: handle(async (req, reply) => sendSuccess(reply, await service.getSettings(scopeOf(req).tenantId))),

  updateSettings: handle(async (req, reply) =>
    sendSuccess(reply, await service.updateSettings(scopeOf(req), settingsSchema.parse(req.body))),
  ),
};
