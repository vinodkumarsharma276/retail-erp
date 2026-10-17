import { z } from 'zod';
import { sendSuccess } from '../../../utils/response.js';
import { handle, scopeOf } from '../bank-statements.controller.js';
import * as feeds from './feeds.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const connectSchema = z.object({
  bankAccountId: z.string().uuid(),
  provider: z.string().min(1).max(20),
  credentials: z.record(z.string().max(4000)).default({}),
  startDate: isoDate,
  autoSync: z.boolean().default(true),
});

const updateSchema = z.object({
  autoSync: z.boolean().optional(),
  paused: z.boolean().optional(),
});

export const feedsController = {
  list: handle(async (req, reply) => sendSuccess(reply, await feeds.listFeeds(scopeOf(req)))),

  connect: handle(async (req, reply) => {
    const body = connectSchema.parse(req.body);
    const scope = scopeOf(req);
    const { id } = await feeds.connectFeed(scope, req.currentUser!.userId, body);
    // First sync straight away so the user sees transactions arrive.
    let firstSync: unknown = null;
    try {
      firstSync = await feeds.syncFeedById(scope, id);
    } catch (err) {
      firstSync = { error: err instanceof Error ? err.message : String(err) };
    }
    return sendSuccess(reply, { id, firstSync }, 201);
  }),

  update: handle(async (req, reply) => {
    await feeds.updateFeed(scopeOf(req), req.params.id, updateSchema.parse(req.body));
    return sendSuccess(reply, { updated: true });
  }),

  disconnect: handle(async (req, reply) => {
    await feeds.disconnectFeed(scopeOf(req), req.params.id);
    return sendSuccess(reply, { deleted: true });
  }),

  sync: handle(async (req, reply) => sendSuccess(reply, await feeds.syncFeedById(scopeOf(req), req.params.id))),

  runs: handle(async (req, reply) => sendSuccess(reply, await feeds.listRuns(scopeOf(req), req.params.id))),
};
