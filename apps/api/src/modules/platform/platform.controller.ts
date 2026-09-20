import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { platformAuthService, tenantsService, plansService } from './platform.service.js';

// ─── Platform admin authentication ──────────────────────────────────────────

export const platformAuthController = {
  async login(
    request: FastifyRequest<{ Body: { username: string; password: string } }>,
    reply: FastifyReply,
  ) {
    const { username, password } = request.body;
    const admin = await platformAuthService.validateCredentials(username, password);
    if (!admin) return sendError(reply, 'Invalid username or password', 401);

    const accessToken = request.server.jwt.sign(
      {
        platformUserId: admin.id,
        username: admin.username,
        scope: 'platform',
      },
      { expiresIn: config.jwt.accessExpiresIn },
    );

    const refreshToken = crypto.randomUUID();
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await platformAuthService.storeRefreshToken(
      admin.id,
      refreshHash,
      (request.headers['user-agent'] ?? null) as string | null,
    );
    await platformAuthService.updateLastLogin(admin.id);

    return sendSuccess(reply, {
      accessToken,
      refreshToken,
      platformUser: {
        id: admin.id,
        username: admin.username,
        fullName: admin.fullName,
        email: admin.email,
      },
    });
  },

  async refresh(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) {
    const tokenHash = crypto.createHash('sha256').update(request.body.refreshToken).digest('hex');
    const stored = await platformAuthService.findValidRefreshToken(tokenHash);
    if (!stored) return sendError(reply, 'Invalid or expired refresh token', 401);

    await platformAuthService.revokeRefreshToken(tokenHash);

    const accessToken = request.server.jwt.sign(
      {
        platformUserId: stored.platformUser.id,
        username: stored.platformUser.username,
        scope: 'platform',
      },
      { expiresIn: config.jwt.accessExpiresIn },
    );
    const newRefreshToken = crypto.randomUUID();
    const newRefreshHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    await platformAuthService.storeRefreshToken(stored.platformUserId, newRefreshHash);

    return sendSuccess(reply, { accessToken, refreshToken: newRefreshToken });
  },

  async logout(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) {
    if (request.body.refreshToken) {
      const tokenHash = crypto
        .createHash('sha256')
        .update(request.body.refreshToken)
        .digest('hex');
      await platformAuthService.revokeRefreshToken(tokenHash);
    }
    return sendSuccess(reply, { message: 'Logged out' });
  },

  async me(request: FastifyRequest, reply: FastifyReply) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    return sendSuccess(reply, { platformUser: request.platformUser });
  },
};

// ─── Tenants ────────────────────────────────────────────────────────────────

export const tenantsController = {
  async list(
    request: FastifyRequest<{ Querystring: { status?: string; q?: string } }>,
    reply: FastifyReply,
  ) {
    const tenants = await tenantsService.list({
      status: request.query.status,
      q: request.query.q,
    });
    return sendSuccess(reply, tenants);
  },

  async get(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const tenant = await tenantsService.getById(request.params.id);
    if (!tenant) return sendError(reply, 'Tenant not found', 404);
    return sendSuccess(reply, tenant);
  },

  async create(
    request: FastifyRequest<{ Body: Parameters<typeof tenantsService.create>[0] }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    try {
      const result = await tenantsService.create(request.body, request.platformUser.platformUserId);
      return sendSuccess(reply, result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create tenant';
      if (
        message.startsWith('Plan ') ||
        message.startsWith('Tenant slug ') ||
        message === 'Tenant has no active owner user'
      ) {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Parameters<typeof tenantsService.update>[1];
    }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    try {
      const updated = await tenantsService.update(
        request.params.id,
        request.body,
        request.platformUser.platformUserId,
      );
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update tenant';
      if (message === 'Tenant not found') return sendError(reply, message, 404);
      if (message.startsWith('Plan ')) return sendError(reply, message, 400);
      return sendError(reply, message, 500);
    }
  },

  async listFeatures(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const features = await tenantsService.listFeatures(request.params.id);
      return sendSuccess(reply, features);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch features';
      if (message === 'Tenant not found') return sendError(reply, message, 404);
      return sendError(reply, message, 500);
    }
  },

  async upsertFeature(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Parameters<typeof tenantsService.upsertFeature>[1];
    }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    try {
      const updated = await tenantsService.upsertFeature(
        request.params.id,
        request.body,
        request.platformUser.platformUserId,
      );
      return sendSuccess(reply, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upsert feature';
      if (message === 'Tenant not found') return sendError(reply, message, 404);
      return sendError(reply, message, 500);
    }
  },

  async deleteFeatureOverride(
    request: FastifyRequest<{ Params: { id: string; featureKey: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    await tenantsService.deleteFeatureOverride(
      request.params.id,
      request.params.featureKey,
      request.platformUser.platformUserId,
    );
    return sendSuccess(reply, { message: 'Override removed; tenant inherits plan default' });
  },

  async resetOwnerPassword(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    try {
      const result = await tenantsService.resetOwnerPassword(
        request.params.id,
        request.platformUser.platformUserId,
      );
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset password';
      if (message === 'Tenant not found' || message === 'Tenant has no active owner user') {
        return sendError(reply, message, 400);
      }
      return sendError(reply, message, 500);
    }
  },
};

// ─── Plans ──────────────────────────────────────────────────────────────────

export const plansController = {
  async list(_request: FastifyRequest, reply: FastifyReply) {
    const plans = await plansService.list();
    return sendSuccess(reply, plans);
  },

  async get(
    request: FastifyRequest<{ Params: { code: string } }>,
    reply: FastifyReply,
  ) {
    const plan = await plansService.getByCode(request.params.code);
    if (!plan) return sendError(reply, 'Plan not found', 404);
    return sendSuccess(reply, plan);
  },

  async create(
    request: FastifyRequest<{ Body: Parameters<typeof plansService.create>[0] }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    const plan = await plansService.create(request.body, request.platformUser.platformUserId);
    return sendSuccess(reply, plan, 201);
  },

  async update(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Parameters<typeof plansService.update>[1];
    }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    const plan = await plansService.update(
      request.params.id,
      request.body,
      request.platformUser.platformUserId,
    );
    return sendSuccess(reply, plan);
  },

  async setFeature(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Parameters<typeof plansService.setFeature>[1];
    }>,
    reply: FastifyReply,
  ) {
    if (!request.platformUser) return sendError(reply, 'Authentication required', 401);
    const pf = await plansService.setFeature(
      request.params.id,
      request.body,
      request.platformUser.platformUserId,
    );
    return sendSuccess(reply, pf);
  },
};
