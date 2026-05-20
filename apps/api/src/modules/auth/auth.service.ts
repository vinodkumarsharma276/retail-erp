import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';

const SALT_ROUNDS = 10;

export const authService = {
  /** List active shops in a specific tenant — used by the login screen. */
  async listShops(tenantId: string) {
    try {
      return await prisma.shop.findMany({
        where: { isActive: true, tenantId },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      throw new Error('Failed to fetch shops');
    }
  },

  /**
   * Validate username+password within a specific tenant scope. Username
   * uniqueness is `(tenantId, username)` post-Phase-1, so a stolen username
   * from Tenant A cannot authenticate on Tenant B even if the passwords
   * happen to match.
   */
  async validateCredentials(tenantId: string, username: string, password: string) {
    try {
      const user = await prisma.user.findFirst({
        where: { tenantId, username },
        include: {
          userShops: {
            where: { tenantId },
            include: { shop: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      });

      if (!user || !user.isActive) return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return user;
    } catch (error) {
      throw new Error('Failed to validate credentials');
    }
  },

  async verifyUserShopAccess(userId: string, shopId: string, tenantId: string) {
    try {
      const assignment = await prisma.userShop.findFirst({
        where: { userId, shopId, tenantId },
      });
      return !!assignment;
    } catch (error) {
      throw new Error('Failed to verify shop access');
    }
  },

  async updateLastLogin(userId: string) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
    } catch (error) {
      throw new Error('Failed to update last login');
    }
  },

  async storeRefreshToken(
    userId: string,
    tenantId: string,
    tokenHash: string,
    deviceInfo?: string,
  ) {
    try {
      await prisma.refreshToken.create({
        data: {
          userId,
          tenantId,
          tokenHash,
          deviceInfo,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });
    } catch (error) {
      throw new Error('Failed to store refresh token');
    }
  },

  async revokeRefreshToken(tokenHash: string) {
    try {
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch (error) {
      throw new Error('Failed to revoke refresh token');
    }
  },

  /**
   * Look up a refresh token within a tenant. We scope by tenantId so a
   * stolen refresh token from Tenant A cannot be used to mint access
   * tokens on Tenant B.
   */
  async findValidRefreshToken(tokenHash: string, tenantId: string) {
    try {
      return await prisma.refreshToken.findFirst({
        where: {
          tokenHash,
          tenantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          user: {
            include: {
              userShops: {
                where: { tenantId },
                include: { shop: true },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
      });
    } catch (error) {
      throw new Error('Failed to find refresh token');
    }
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new Error('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Revoke all existing refresh tokens for the user so they must re-login on other devices
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async getShopById(shopId: string, tenantId: string) {
    return prisma.shop.findFirst({
      where: { id: shopId, tenantId },
      select: { id: true, name: true, code: true },
    });
  },

  async getUserWithShops(userId: string, tenantId: string) {
    return prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: {
        userShops: {
          where: { tenantId },
          include: { shop: { select: { id: true, name: true, code: true } } },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
  },

  async getPreferences(userId: string) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    return (u?.preferences as Record<string, unknown> | null) ?? null;
  },

  async updatePreferences(userId: string, prefs: Record<string, unknown>) {
    const u = await prisma.user.update({
      where: { id: userId },
      data: { preferences: prefs as any },
      select: { preferences: true },
    });
    return (u.preferences as Record<string, unknown> | null) ?? null;
  },
};
