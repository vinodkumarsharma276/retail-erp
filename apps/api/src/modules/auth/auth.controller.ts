import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { authService } from './auth.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';
import { config } from '../../config/index.js';

export const authController = {
  async listShops(_request: FastifyRequest, reply: FastifyReply) {
    const shops = await authService.listShops();
    return sendSuccess(reply, shops);
  },

  async login(
    request: FastifyRequest<{
      Body: { username: string; password: string; shopId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { username, password, shopId } = request.body;

    const user = await authService.validateCredentials(username, password);
    if (!user) {
      return sendError(reply, 'Invalid username or password', 401);
    }

    const hasAccess = await authService.verifyUserShopAccess(user.id, shopId);
    if (!hasAccess) {
      return sendError(reply, 'You do not have access to this shop', 403);
    }

    const accessToken = request.server.jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        shopId,
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
        isMobileOnly: user.isMobileOnly,
      },
      shop: user.userShops.find((us) => us.shopId === shopId)?.shop,
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
    const accessToken = request.server.jwt.sign(
      {
        userId: stored.user.id,
        username: stored.user.username,
        role: stored.user.role,
        shopId: stored.userId, // Will be fixed with proper shop tracking
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
    return sendSuccess(reply, request.currentUser);
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

    if (request.currentUser.role !== 'admin' && request.currentUser.role !== 'accountant') {
      return sendError(reply, 'Only admins and accountants can switch shops', 403);
    }

    const hasAccess = await authService.verifyUserShopAccess(
      request.currentUser.userId,
      request.body.shopId,
    );
    if (!hasAccess) {
      return sendError(reply, 'You do not have access to this shop', 403);
    }

    const accessToken = request.server.jwt.sign(
      {
        ...request.currentUser,
        shopId: request.body.shopId,
      },
      { expiresIn: config.jwt.accessExpiresIn },
    );

    return sendSuccess(reply, { accessToken });
  },
};
