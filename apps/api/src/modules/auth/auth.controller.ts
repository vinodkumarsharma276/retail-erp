import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { authService } from './auth.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { config } from '../../config/index.js';
import { loadEffectivePermissionsForUser } from '../../middleware/permissions.js';

export const authController = {
  async listShops(_request: FastifyRequest, reply: FastifyReply) {
    const shops = await authService.listShops();
    return sendSuccess(reply, shops);
  },

  async login(
    request: FastifyRequest<{
      Body: { username: string; password: string };
    }>,
    reply: FastifyReply,
  ) {
    const { username, password } = request.body;

    const user = await authService.validateCredentials(username, password);
    if (!user) {
      return sendError(reply, 'Invalid username or password', 401);
    }

    const selectedShop =
      user.userShops.find((us) => us.isPrimary && us.shop.isActive)?.shop ??
      user.userShops.find((us) => us.shop.isActive)?.shop;
    if (!selectedShop) {
      return sendError(reply, 'No active shop is assigned to this user', 403);
    }

    const accessToken = request.server.jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        shopId: selectedShop.id,
        isMobileOnly: user.isMobileOnly,
      },
      { expiresIn: config.jwt.accessExpiresIn },
    );

    const refreshToken = crypto.randomUUID();
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await authService.storeRefreshToken(user.id, refreshHash, request.headers['user-agent']);
    await authService.updateLastLogin(user.id);

    return sendSuccess(reply, {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        roleId: (user as any).roleId ?? null,
        isMobileOnly: user.isMobileOnly,
        preferences: (user as any).preferences ?? null,
      },
      permissions: Array.from(await loadEffectivePermissionsForUser(user.id)),
      shop: { id: selectedShop.id, name: selectedShop.name, code: selectedShop.code },
    });
  },

  async refresh(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) {
    const { refreshToken } = request.body;
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const stored = await authService.findValidRefreshToken(tokenHash);
    if (!stored) {
      return sendError(reply, 'Invalid or expired refresh token', 401);
    }

    // Revoke old token
    await authService.revokeRefreshToken(tokenHash);

    // Issue new tokens
    const selectedShop =
      stored.user.userShops.find((us) => us.isPrimary && us.shop.isActive)?.shop ??
      stored.user.userShops.find((us) => us.shop.isActive)?.shop;
    if (!selectedShop) {
      return sendError(reply, 'No active shop is assigned to this user', 403);
    }

    const accessToken = request.server.jwt.sign(
      {
        userId: stored.user.id,
        username: stored.user.username,
        role: stored.user.role,
        shopId: selectedShop.id,
        isMobileOnly: stored.user.isMobileOnly,
      },
      { expiresIn: config.jwt.accessExpiresIn },
    );

    const newRefreshToken = crypto.randomUUID();
    const newRefreshHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    await authService.storeRefreshToken(stored.userId, newRefreshHash);

    return sendSuccess(reply, { accessToken, refreshToken: newRefreshToken });
  },

  async me(request: FastifyRequest, reply: FastifyReply) {
    if (!request.currentUser) {
      return sendError(reply, 'Authentication required', 401);
    }

    // Fetch full user with shops from DB (not just JWT payload)
    const user = await authService.getUserWithShops(request.currentUser.userId);
    if (!user) {
      return sendError(reply, 'User not found', 404);
    }

    return sendSuccess(reply, {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        roleId: (user as any).roleId ?? null,
        isMobileOnly: user.isMobileOnly,
        preferences: (user as any).preferences ?? null,
      },
      permissions: Array.from(await loadEffectivePermissionsForUser(user.id)),
      shops: user.userShops.map((us: any) => ({
        id: us.shop.id,
        name: us.shop.name,
        code: us.shop.code,
      })),
    });
  },

  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    if (!request.currentUser) {
      return sendError(reply, 'Authentication required', 401);
    }
    const prefs = await authService.getPreferences(request.currentUser.userId);
    return sendSuccess(reply, prefs ?? {});
  },

  async updatePreferences(
    request: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) {
    if (!request.currentUser) {
      return sendError(reply, 'Authentication required', 401);
    }
    // Merge with existing so partial updates don't wipe other prefs
    const existing = (await authService.getPreferences(request.currentUser.userId)) ?? {};
    const next = { ...existing, ...(request.body ?? {}) };
    const saved = await authService.updatePreferences(request.currentUser.userId, next);
    return sendSuccess(reply, saved ?? {});
  },

  async logout(request: FastifyRequest<{ Body: { refreshToken: string } }>, reply: FastifyReply) {
    const { refreshToken } = request.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await authService.revokeRefreshToken(tokenHash);
    }
    return sendSuccess(reply, { message: 'Logged out successfully' });
  },

  async changePassword(
    request: FastifyRequest<{ Body: { currentPassword: string; newPassword: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.currentUser) {
      return sendError(reply, 'Authentication required', 401);
    }

    const { currentPassword, newPassword } = request.body;

    try {
      await authService.changePassword(request.currentUser.userId, currentPassword, newPassword);
      return sendSuccess(reply, { message: 'Password changed successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to change password';
      if (message === 'Current password is incorrect') {
        return sendError(reply, message, 400);
      }
      if (message === 'User not found') {
        return sendError(reply, message, 404);
      }
      return sendError(reply, message, 500);
    }
  },

  async switchShop(
    request: FastifyRequest<{ Body: { shopId: string } }>,
    reply: FastifyReply,
  ) {
    if (!request.currentUser) {
      return sendError(reply, 'Authentication required', 401);
    }

    if (
      request.currentUser.role !== 'owner' &&
      request.currentUser.role !== 'admin' &&
      request.currentUser.role !== 'accountant'
    ) {
      return sendError(reply, 'You cannot switch shops', 403);
    }

    const hasAccess = await authService.verifyUserShopAccess(
      request.currentUser.userId,
      request.body.shopId,
    );
    if (!hasAccess) {
      return sendError(reply, 'You do not have access to this shop', 403);
    }

    const newShopId = request.body.shopId;

    const accessToken = request.server.jwt.sign(
      {
        ...request.currentUser,
        shopId: newShopId,
      },
      { expiresIn: config.jwt.accessExpiresIn },
    );

    // Fetch shop details to return to frontend
    const shop = await authService.getShopById(newShopId);

    return sendSuccess(reply, {
      accessToken,
      shop: shop ? { id: shop.id, name: shop.name, code: shop.code } : null,
    });
  },
};
