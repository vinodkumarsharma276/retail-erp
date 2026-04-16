import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';

const SALT_ROUNDS = 10;

export const authService = {
  async listShops() {
    try {
      return await prisma.shop.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      throw new Error('Failed to fetch shops');
    }
  },

  async validateCredentials(username: string, password: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { username },
        include: { userShops: { include: { shop: true } } },
      });

      if (!user || !user.isActive) return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return user;
    } catch (error) {
      throw new Error('Failed to validate credentials');
    }
  },

  async verifyUserShopAccess(userId: string, shopId: string) {
    try {
      const assignment = await prisma.userShop.findFirst({
        where: { userId, shopId },
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

  async storeRefreshToken(userId: string, tokenHash: string, deviceInfo?: string) {
    try {
      await prisma.refreshToken.create({
        data: {
          userId,
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

  async findValidRefreshToken(tokenHash: string) {
    try {
      return await prisma.refreshToken.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: true },
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

  async getShopById(shopId: string) {
    return prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, code: true },
    });
  },

  async getUserWithShops(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: { userShops: { include: { shop: { select: { id: true, name: true, code: true } } } } },
    });
  },
};
